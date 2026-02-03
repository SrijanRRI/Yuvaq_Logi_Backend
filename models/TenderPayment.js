import mongoose from "mongoose";

const TenderPaymentSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true, index: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true },
    rrUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Razorpay order/payment
    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    amount: { type: Number, required: true }, // paise
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["created", "paid", "captured", "failed"],
      default: "created",
      index: true,
    },

    // What you want visible in Razorpay dashboard (stored in order notes too)
    notes: { type: Object },

    // Useful payment details (fetched from Razorpay)
    method: String,
    bank: String,
    wallet: String,
    vpa: String,
    email: String,
    contact: String,
    fee: Number,
    tax: Number,
    card: Object,

    paidAt: Date,
    capturedAt: Date,

    // Raw payload snapshots (optional)
    rawPayment: Object,
    webhookEvents: [Object],
  },
  { timestamps: true }
);

export default mongoose.model("TenderPayment", TenderPaymentSchema);
