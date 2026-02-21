import mongoose from "mongoose";

const SubscriptionPaymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    purpose: { type: String, default: "subscription", index: true },

    plan: { type: String, enum: ["monthly", "yearly"], required: true },

    // Razorpay stores amount in paise
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["created", "paid", "captured", "failed"],
      default: "created",
      index: true,
    },

    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },

    notes: { type: Object, default: {} },

    // optional audit
    webhookEvents: [
      {
        receivedAt: Date,
        eventType: String,
        event: Object,
      },
    ],

    // optional Razorpay payment fields
    method: String,
    bank: String,
    wallet: String,
    vpa: String,
    email: String,
    contact: String,
    fee: Number,
    tax: Number,
    card: Object,
    rawPayment: Object,

    paidAt: Date,
    capturedAt: Date,
  },
  { timestamps: true }
);

// Useful for reuse/pending lookup
SubscriptionPaymentSchema.index({ userId: 1, plan: 1, status: 1, createdAt: -1 });

export default mongoose.model("SubscriptionPayment", SubscriptionPaymentSchema);