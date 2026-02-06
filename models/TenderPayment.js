import mongoose from "mongoose";

const TenderPaymentSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true },
    rrUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    purpose: { type: String, default: "tender_finalization_advance" },

    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    amount: { type: Number, required: true }, // paise
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["created", "paid", "captured", "failed"],
      default: "created",
    },

    notes: { type: Object },

    finalizedAt: { type: Date }, // when tender successfully finalized
    rawPayment: { type: Object },

    webhookEvents: [
      {
        receivedAt: Date,
        eventType: String,
        event: Object,
      },
    ],
  },
  { timestamps: true }
);

// ✅ One active payment row per tender+quotation+rrUser+purpose (prevents double charges)
TenderPaymentSchema.index(
  { tenderId: 1, quotationId: 1, rrUserId: 1, purpose: 1 },
  { unique: true }
);

export default mongoose.model("TenderPayment", TenderPaymentSchema);