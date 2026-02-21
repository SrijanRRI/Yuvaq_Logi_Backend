import crypto from "crypto";
import moment from "moment";
import { razorpay } from "../services/razorpayClient.js";
import User from "../models/userSchema.js";
import SubscriptionPayment from "../models/subscriptionPaymentSchema.js";

const INR_TO_PAISE = (inr) => Math.round(Number(inr) * 100);

function hmacSHA256(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getPlanConfig(plan) {
  const monthly = Number(process.env.SUBSCRIPTION_MONTHLY_INR || 0);
  const yearly = Number(process.env.SUBSCRIPTION_YEARLY_INR || 0);

  if (plan === "monthly") return { inr: monthly, unit: "month", count: 1 };
  if (plan === "yearly") return { inr: yearly, unit: "year", count: 1 };
  return null;
}

function makeReceipt(userId) {
  const idPart = String(userId).slice(-8);
  const tsPart = Date.now().toString(36);
  const rnd = crypto.randomBytes(2).toString("hex");
  return `sub_${idPart}_${tsPart}_${rnd}`.slice(0, 40);
}

function computeNewEndsAt(currentEndsAt, plan) {
  const cfg = getPlanConfig(plan);
  if (!cfg) return null;

  const now = new Date();
  const base = currentEndsAt && new Date(currentEndsAt) > now ? new Date(currentEndsAt) : now;
  return moment(base).add(cfg.count, cfg.unit).toDate();
}

function isActiveSubscription(sub) {
  if (!sub?.endsAt) return false;
  return sub.status === "active" && new Date(sub.endsAt) > new Date();
}

/**
 * GET /subscriptions/me
 */
export const getMySubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("role subscription name email");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const active = isActiveSubscription(user.subscription);

    // auto-mark expired (no cron needed)
    if (!active && user.subscription?.status === "active") {
      user.subscription.status = "expired";
      user.subscription.updatedAt = new Date();
      await user.save();
    }

    return res.json({
      success: true,
      data: {
        role: user.role,
        subscription: user.subscription || { status: "none" },
        isActive: active,
        now: new Date(),
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /subscriptions/plans (public or auth; your choice)
 */
export const getSubscriptionPlans = async (req, res) => {
  const monthly = getPlanConfig("monthly");
  const yearly = getPlanConfig("yearly");

  return res.json({
    success: true,
    plans: [
      { plan: "monthly", amountInr: monthly?.inr || 0, label: "Monthly" },
      { plan: "yearly", amountInr: yearly?.inr || 0, label: "Yearly" },
    ],
  });
};

/**
 * POST /subscriptions/order
 * body: { plan: "monthly" | "yearly" }
 */
export const createSubscriptionOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan } = req.body;

    if (!plan || !["monthly", "yearly"].includes(String(plan))) {
      return res.status(400).json({ success: false, message: "Invalid plan" });
    }

    const user = await User.findById(userId).select("role subscription");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // admin never pays
    if (user.role === "admin") {
      return res.status(403).json({ success: false, message: "Admin does not need subscription" });
    }

    // if already active, no need to pay
    if (isActiveSubscription(user.subscription)) {
      return res.status(200).json({
        success: true,
        alreadyActive: true,
        subscription: user.subscription,
      });
    }

    const cfg = getPlanConfig(plan);
    if (!cfg || !cfg.inr || cfg.inr <= 0) {
      return res.status(500).json({ success: false, message: "Plan pricing not configured" });
    }

    // ✅ reuse a recent pending order (avoid multiple order spam)
    const pending = await SubscriptionPayment.findOne({
      userId,
      plan,
      status: "created",
      createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) }, // 15 min
    }).sort({ createdAt: -1 });

    if (pending) {
      return res.json({
        success: true,
        reusedOrder: true,
        alreadyActive: false,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: pending.razorpayOrderId,
        amount: pending.amount,
        currency: pending.currency,
        plan,
      });
    }

    const amountPaise = INR_TO_PAISE(cfg.inr);

    const notes = {
      purpose: "subscription",
      userId: String(userId),
      plan: String(plan),
    };

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: makeReceipt(userId),
      notes,
    });

    await SubscriptionPayment.create({
      userId,
      plan,
      amount: order.amount,
      currency: order.currency,
      status: "created",
      razorpayOrderId: order.id,
      notes,
    });

    return res.json({
      success: true,
      reusedOrder: false,
      alreadyActive: false,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      plan,
    });
  } catch (err) {
    console.error("createSubscriptionOrder error:", err);
    return res.status(500).json({ success: false, message: "Could not create subscription order" });
  }
};

/**
 * POST /subscriptions/verify
 * body: { plan, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export const verifySubscriptionPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!plan || !["monthly", "yearly"].includes(String(plan))) {
      return res.status(400).json({ success: false, message: "Invalid plan" });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay fields" });
    }

    // signature verify
    const expected = hmacSHA256(
      process.env.RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`
    );

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    const payRow = await SubscriptionPayment.findOne({ razorpayOrderId: razorpay_order_id });
    if (!payRow) return res.status(404).json({ success: false, message: "Order not found" });

    // ensure same user
    if (String(payRow.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // idempotent: if already captured, just return active subscription
    if (payRow.status === "captured" || payRow.status === "paid") {
      const user = await User.findById(userId).select("subscription role");
      return res.json({
        success: true,
        alreadyProcessed: true,
        subscription: user?.subscription,
      });
    }

    // fetch payment details (optional but good)
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

    // activate subscription in user
    const user = await User.findById(userId).select("role subscription");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const newEndsAt = computeNewEndsAt(user.subscription?.endsAt, plan);
    user.subscription = {
      status: "active",
      plan,
      startsAt: user.subscription?.startsAt || new Date(),
      endsAt: newEndsAt,
      lastPaymentId: razorpay_payment_id,
      updatedAt: new Date(),
    };
    await user.save();

    return res.json({
      success: true,
      message: "Subscription activated",
      subscription: user.subscription,
    });
  } catch (err) {
    console.error("verifySubscriptionPayment error:", err);
    return res.status(500).json({ success: false, message: "Subscription verification failed" });
  }
};