import crypto from "crypto";
import { razorpay } from "../services/razorpayClient.js";
import TenderPayment from "../models/TenderPayment.js";

// import Tender from "../models/Tender.js";       // <-- use your real model
// import Quotation from "../models/Quotation.js"; // <-- use your real model

const INR_TO_PAISE = (inr) => Math.round(Number(inr) * 100);

function hmacSHA256(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function makeReceipt(tenderId) {
  // Example: td_a1b2c3d4_k9z3l0p (always short)
  const idPart = String(tenderId).slice(-8); // last 8 chars of ObjectId
  const tsPart = Date.now().toString(36); // base36 timestamp (short)
  const rnd = crypto.randomBytes(2).toString("hex"); // 4 chars random
  const receipt = `td_${idPart}_${tsPart}_${rnd}`;
  return receipt.slice(0, 40); // hard cap
}

/**
 * ✅ 1) Create Razorpay Order + store DB payment row
 * POST /tenders/:id/finalize/payment/order
 * body: { quotationId, finalPrice }
 */
export const createFinalizeOrder = async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const tenderId = req.params.id;
    const { quotationId, finalPrice } = req.body;

    const price = Number(finalPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ message: "Invalid finalPrice" });
    }
    if (!quotationId) {
      return res.status(400).json({ message: "quotationId is required" });
    }

    const amount = INR_TO_PAISE(price);

    const notes = {
      purpose: "tender_finalization",
      tenderId: String(tenderId),
      quotationId: String(quotationId),
      rrUserId: String(req.user?.id || ""),
      finalPriceINR: String(price),
    };

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: makeReceipt(tenderId), // ✅ FIXED
      notes,
    });

    await TenderPayment.create({
      tenderId,
      quotationId,
      rrUserId: req.user?.id,
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
    const tenderId = req.params.id;
    const {
      quotationId,
      finalPrice,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing Razorpay fields" });
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

    // 4) ✅ Finalize tender ONLY after payment verified
    // IMPORTANT: make finalize idempotent (if already finalized, return success)
    // Example (replace with your existing logic/service):
    //
    // const tender = await tenderSchema.findById(tenderId);
    // if (!tender) return res.status(404).json({ message: "Tender not found" });
    // if (tender.status !== "finalized") {
    //   tender.status = "finalized";
    //   tender.selectedQuotation = quotationId;
    //   tender.finalPrice = Number(finalPrice);
    //   tender.finalPayment = {
    //     orderId: razorpay_order_id,
    //     paymentId: razorpay_payment_id,
    //   };
    //   await tender.save();
    // }

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
