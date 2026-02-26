import crypto from "crypto";
import { razorpay } from "../services/razorpayClient.js";
import TenderPayment from "../models/TenderPayment.js";

import Tender from "../models/tenderSchema.js";
import Quotation from "../models/quotationSchema.js";

const INR_TO_PAISE = (inr) => Math.round(Number(inr) * 100);

function makeReceipt(tenderId) {
  const idPart = String(tenderId).slice(-8);
  const tsPart = Date.now().toString(36);
  const rnd = crypto.randomBytes(2).toString("hex");
  return `td_${idPart}_${tsPart}_${rnd}`.slice(0, 40);
}

function sumMaterialWeightMt(materials = []) {
  return (materials || []).reduce((sum, m) => sum + Number(m?.weight || 0), 0);
}

function hmacSHA256(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * ✅ 1) Create Razorpay Order + store DB payment row
 * POST /tenders/:id/finalize/payment/order
 * body: { quotationId, finalPrice }
 */

const SERVER_ADVANCE_PERCENT = Number(
  process.env.FINALIZE_ADVANCE_PERCENT ?? 5,
);

export const createFinalizeOrder = async (req, res) => {
  const percent = Number.isFinite(SERVER_ADVANCE_PERCENT)
    ? SERVER_ADVANCE_PERCENT
    : 5;

  if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

  try {
    const tenderId = req.params.id;
    const { quotationId } = req.body;

    if (!quotationId) {
      return res.status(400).json({ message: "quotationId is required" });
    }

    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: "Tender not found" });

    if (String(tender.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // If already finalized, don't create/ask payment again
    if (tender.status === "finalized" || tender.selectedQuotation) {
      return res.status(200).json({
        alreadyFinalized: true,
        message: "Tender already finalized",
      });
    }

    const quotation = await Quotation.findOne({
      _id: quotationId,
      tender: tenderId,
    });
    if (!quotation)
      return res.status(400).json({ message: "Invalid quotation" });

    const purpose = "tender_finalization_advance";

    // ✅ allow 0%
    if (!Number.isFinite(percent) || percent < 0) {
      return res.status(400).json({ message: "Invalid advance percent" });
    }

    // ✅ MUST be confirmed BEFORE we allow free/calc/order
    if (
      tender.selection?.status !== "confirmed" ||
      String(tender.selection?.quotation) !== String(quotationId)
    ) {
      return res.status(409).json({
        success: false,
        message: "Transporter has not confirmed this quotation yet.",
      });
    }

    // ✅ 1) Check if a payment row already exists (idempotency key)
    const existing = await TenderPayment.findOne({
      tenderId,
      quotationId,
      rrUserId: req.user.id,
      purpose,
    });

    // ✅ PROMO/FREE MODE (percent == 0) => mark payment as captured with amount 0
    // 📌 PUT THIS RIGHT HERE (after existing is loaded)
    if (percent === 0) {
      // already paid/captured => return
      if (existing && ["paid", "captured"].includes(existing.status)) {
        return res.json({
          alreadyPaid: true,
          alreadyFinalized: false,
          promoFree: true,
          keyId: process.env.RAZORPAY_KEY_ID,
          orderId: existing.razorpayOrderId,
          amount: existing.amount ?? 0,
          currency: existing.currency ?? "INR",
          notes: existing.notes || {},
        });
      }

      const notes = {
        purpose,
        mode: "promo_free",
        tenderId: String(tenderId),
        quotationId: String(quotationId),
        rrUserId: String(req.user.id),
        advancePercent: "0",
        advanceRupees: "0",
      };

      // if there is an existing unpaid order row (created/failed), convert it to captured=0
      if (existing) {
        existing.status = "captured";
        existing.amount = 0;
        existing.currency = existing.currency || "INR";
        existing.notes = { ...(existing.notes || {}), ...notes };
        existing.paidAt = existing.paidAt || new Date();
        existing.capturedAt = existing.capturedAt || new Date();
        await existing.save();

        return res.json({
          alreadyPaid: true,
          alreadyFinalized: false,
          promoFree: true,
          keyId: process.env.RAZORPAY_KEY_ID,
          orderId: existing.razorpayOrderId,
          amount: 0,
          currency: existing.currency || "INR",
          notes: existing.notes || {},
        });
      }

      // create a pseudo order id (not a real Razorpay order) for bookkeeping
      const pseudoOrderId = `FREE_${makeReceipt(tenderId)}`;

      await TenderPayment.create({
        tenderId,
        quotationId,
        rrUserId: req.user.id,
        purpose,
        razorpayOrderId: pseudoOrderId,
        amount: 0,
        currency: "INR",
        status: "captured",
        notes,
        paidAt: new Date(),
        capturedAt: new Date(),
      });

      return res.json({
        alreadyPaid: true,
        alreadyFinalized: false,
        promoFree: true,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: pseudoOrderId,
        amount: 0,
        currency: "INR",
        notes,
      });
    }

    // ✅ If existing order/payment exists (normal paid flow)
    if (existing) {
      if (existing.status === "paid" || existing.status === "captured") {
        return res.json({
          alreadyPaid: true,
          keyId: process.env.RAZORPAY_KEY_ID,
          orderId: existing.razorpayOrderId,
          amount: existing.amount,
          currency: existing.currency,
          razorpayPaymentId: existing.razorpayPaymentId || null,
          notes: existing.notes || {},
        });
      }

      return res.json({
        reusedOrder: true,
        alreadyPaid: false,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: existing.razorpayOrderId,
        amount: existing.amount,
        currency: existing.currency,
        notes: existing.notes || {},
      });
    }

    // ----- No existing row → create NEW Razorpay order (percent > 0 only) -----
    const finalPricePerMt = Number(req.body.finalPricePerMt ?? quotation.price);
    const totalWeightMt = Number(
      req.body.totalWeightMt ??
        tender.totalWeight ??
        sumMaterialWeightMt(tender.materials || []),
    );

    if (!Number.isFinite(finalPricePerMt) || finalPricePerMt <= 0) {
      return res.status(400).json({ message: "Invalid finalPricePerMt" });
    }
    if (!Number.isFinite(totalWeightMt) || totalWeightMt <= 0) {
      return res.status(400).json({ message: "Invalid totalWeightMt" });
    }

    const totalRupees = finalPricePerMt * totalWeightMt;
    const advanceRupees = (totalRupees * percent) / 100;
    const amountPaise = INR_TO_PAISE(advanceRupees);

    const notes = {
      purpose,
      mode: "computed_advance",
      tenderId: String(tenderId),
      quotationId: String(quotationId),
      rrUserId: String(req.user.id),
      finalPricePerMt: String(finalPricePerMt),
      totalWeightMt: String(totalWeightMt),
      totalRupees: String(totalRupees),
      advancePercent: String(percent),
      advanceRupees: String(advanceRupees),
    };

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: makeReceipt(tenderId),
      notes,
    });

    await TenderPayment.create({
      tenderId,
      quotationId,
      rrUserId: req.user.id,
      purpose,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: "created",
      notes,
    });

    return res.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      notes,
      alreadyPaid: false,
      reusedOrder: false,
    });
  } catch (err) {
    console.error("createFinalizeOrder error:", err);
    return res.status(500).json({ message: "Could not create order" });
  }
};

/**
 * ✅ 2) Verify payment signature + fetch payment details + finalize tender
 * POST /tenders/:id/finalize/payment/verify
 * body: { quotationId, finalPrice, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export const verifyFinalizePayment = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

    const tenderId = req.params.id;
    const {
      quotationId,
      // finalPrice,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!quotationId)
      return res.status(400).json({ message: "quotationId is required" });
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing Razorpay fields" });
    }

    // Load tender first (your code was missing this)
    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: "Tender not found" });

    // (optional but recommended) ensure only creator verifies
    if (String(tender.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Guard: transporter must have confirmed the same quotation
    if (
      tender.selection?.status !== "confirmed" ||
      String(tender.selection?.quotation) !== String(quotationId)
    ) {
      return res.status(409).json({
        success: false,
        message: "Transporter has not confirmed this quotation yet.",
      });
    }

    // 1) Verify signature (server-side)
    const expected = hmacSHA256(
      process.env.RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // 2) Find payment row
    const payRow = await TenderPayment.findOne({
      razorpayOrderId: razorpay_order_id,
    });
    if (!payRow)
      return res.status(404).json({ message: "Payment order not found" });

    // Optional: ensure same tender/user
    if (String(payRow.tenderId) !== String(tenderId)) {
      return res.status(400).json({ message: "Order does not match tender" });
    }

    if (
      tender.selection?.status !== "confirmed" ||
      String(tender.selection?.quotation) !== String(quotationId)
    ) {
      return res.status(409).json({
        success: false,
        message: "Transporter has not confirmed this quotation yet.",
      });
    }

    // 3) Fetch payment details from Razorpay (for storing method/bank/fee/tax etc)
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    // Update DB row
    payRow.razorpayPaymentId = razorpay_payment_id;
    payRow.razorpaySignature = razorpay_signature;
    payRow.status = payment.status === "captured" ? "captured" : "paid";
    payRow.method = payment.method;
    payRow.bank = payment.bank;
    payRow.wallet = payment.wallet;
    payRow.vpa = payment.vpa;
    payRow.email = payment.email;
    payRow.contact = payment.contact;
    payRow.fee = payment.fee;
    payRow.tax = payment.tax;
    payRow.card = payment.card;
    payRow.rawPayment = payment;
    payRow.paidAt = new Date();
    if (payment.status === "captured") payRow.capturedAt = new Date();

    await payRow.save();

    return res.json({
      ok: true,
      message: "Payment verified and tender finalized",
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      status: payRow.status,
    });
  } catch (err) {
    console.error("verifyFinalizePayment error:", err);
    return res.status(500).json({ message: "Payment verification failed" });
  }
};

/**
 * ✅ 3) Razorpay Webhook (server-to-server)
 * POST /webhooks/razorpay
 */
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const raw = req.rawBody; // Buffer (set via express.json verify)

    if (!signature || !raw)
      return res.status(400).send("Missing signature/raw");

    const expected = hmacSHA256(process.env.RAZORPAY_WEBHOOK_SECRET, raw);

    if (expected !== signature) {
      return res.status(400).send("Invalid webhook signature");
    }

    const event = req.body; // parsed JSON
    const eventType = event?.event;

    // Store event and update payment record
    if (eventType === "payment.captured" || eventType === "payment.failed") {
      const paymentEntity = event?.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      if (orderId) {
        const payRow = await TenderPayment.findOne({
          razorpayOrderId: orderId,
        });

        if (payRow) {
          payRow.webhookEvents = payRow.webhookEvents || [];
          payRow.webhookEvents.push({
            receivedAt: new Date(),
            eventType,
            event,
          });

          if (eventType === "payment.captured") {
            payRow.status = "captured";
            payRow.razorpayPaymentId = payRow.razorpayPaymentId || paymentId;
            payRow.capturedAt = new Date();
          } else if (eventType === "payment.failed") {
            payRow.status = "failed";
            payRow.razorpayPaymentId = payRow.razorpayPaymentId || paymentId;
          }

          await payRow.save();

          // Optional: if frontend never called verify, you may finalize/reconcile here.
          // Only do it if you trust your stored tenderId/quotationId from payRow.notes
          // and tender is still open.
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("razorpayWebhook error:", err);
    return res.status(500).send("Webhook error");
  }
};

const CONFIRM_ACCEPT_FEE_PERCENT = Number(
  process.env.CONFIRM_ACCEPT_FEE_PERCENT || 0,
);

export const createSelectionAcceptFeeOrder = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

    const tenderId = req.params.id;

    // Tender must exist and be pending confirmation for THIS transporter
    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: "Tender not found" });

    if (tender.selection?.status !== "pending") {
      return res
        .status(409)
        .json({ message: "No pending confirmation for this tender." });
    }

    if (String(tender.selection?.transporter) !== String(req.user.id)) {
      return res
        .status(403)
        .json({ message: "Unauthorized: not selected transporter" });
    }

    const quotationId = String(tender.selection?.quotation || "");
    if (!quotationId)
      return res.status(400).json({ message: "Selected quotation missing" });

    // Fee disabled => tell frontend it's free
    if (
      !Number.isFinite(CONFIRM_ACCEPT_FEE_PERCENT) ||
      CONFIRM_ACCEPT_FEE_PERCENT <= 0
    ) {
      return res.json({
        feePercent: 0,
        payablePaise: 0,
        skipped: true,
        alreadyPaid: true, // treat as no payment required
      });
    }

    // fetch quotation for base amount
    const quotation = await Quotation.findById(quotationId).lean();
    if (!quotation)
      return res.status(404).json({ message: "Quotation not found" });

    const baseAmountRupees = Number(quotation.price || 0);
    if (!Number.isFinite(baseAmountRupees) || baseAmountRupees <= 0) {
      return res.status(400).json({ message: "Invalid quotation price" });
    }

    const feeRupees = (baseAmountRupees * CONFIRM_ACCEPT_FEE_PERCENT) / 100;
    const amountPaise = INR_TO_PAISE(feeRupees);

    const purpose = "selection_confirmation_fee";

    // idempotency: do not create multiple orders
    const existing = await TenderPayment.findOne({
      tenderId,
      quotationId,
      rrUserId: req.user.id, // payer (transporter)
      purpose,
    });

    if (existing) {
      if (existing.status === "paid" || existing.status === "captured") {
        return res.json({
          feePercent: CONFIRM_ACCEPT_FEE_PERCENT,
          alreadyPaid: true,
          keyId: process.env.RAZORPAY_KEY_ID,
          orderId: existing.razorpayOrderId,
          amount: existing.amount,
          currency: existing.currency,
        });
      }

      return res.json({
        feePercent: CONFIRM_ACCEPT_FEE_PERCENT,
        reusedOrder: true,
        alreadyPaid: false,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: existing.razorpayOrderId,
        amount: existing.amount,
        currency: existing.currency,
      });
    }

    const notes = {
      purpose,
      tenderId: String(tenderId),
      quotationId: String(quotationId),
      transporterId: String(req.user.id),
      feePercent: String(CONFIRM_ACCEPT_FEE_PERCENT),
      baseAmountRupees: String(baseAmountRupees),
      feeRupees: String(feeRupees),
    };

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: makeReceipt(tenderId),
      notes,
    });

    await TenderPayment.create({
      tenderId,
      quotationId,
      rrUserId: req.user.id, // payer (transporter)
      purpose,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: "created",
      notes,
    });

    return res.json({
      feePercent: CONFIRM_ACCEPT_FEE_PERCENT,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      alreadyPaid: false,
      reusedOrder: false,
    });
  } catch (err) {
    console.error("createSelectionAcceptFeeOrder error:", err);
    return res
      .status(500)
      .json({ message: "Could not create accept-fee order" });
  }
};

export const verifySelectionAcceptFeePayment = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

    const tenderId = req.params.id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing Razorpay fields" });
    }

    // verify signature
    const expected = hmacSHA256(
      process.env.RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const payRow = await TenderPayment.findOne({
      razorpayOrderId: razorpay_order_id,
      purpose: "selection_confirmation_fee",
      rrUserId: req.user.id, // payer is transporter
    });

    if (!payRow)
      return res.status(404).json({ message: "Payment order not found" });

    if (String(payRow.tenderId) !== String(tenderId)) {
      return res.status(400).json({ message: "Order does not match tender" });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    payRow.razorpayPaymentId = razorpay_payment_id;
    payRow.razorpaySignature = razorpay_signature;
    payRow.status = payment.status === "captured" ? "captured" : "paid";
    payRow.method = payment.method;
    payRow.bank = payment.bank;
    payRow.wallet = payment.wallet;
    payRow.vpa = payment.vpa;
    payRow.email = payment.email;
    payRow.contact = payment.contact;
    payRow.fee = payment.fee;
    payRow.tax = payment.tax;
    payRow.card = payment.card;
    payRow.rawPayment = payment;
    payRow.paidAt = new Date();
    if (payment.status === "captured") payRow.capturedAt = new Date();

    await payRow.save();

    return res.json({
      ok: true,
      message: "Accept fee payment verified",
      status: payRow.status,
    });
  } catch (err) {
    console.error("verifySelectionAcceptFeePayment error:", err);
    return res.status(500).json({ message: "Payment verification failed" });
  }
};
