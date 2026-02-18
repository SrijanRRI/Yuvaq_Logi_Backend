import mongoose from "mongoose";

const fileSchema = new mongoose.Schema({
  url: { type: String, required: true },
  originalName: { type: String },
  mimetype: { type: String },
  uploadedAt: { type: Date, default: Date.now },
});

const quotationSchema = new mongoose.Schema({
  tender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tender",
    required: true,
  },

  transportUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },

  price: { type: Number, required: true },

  phase: {
    type: String,
    enum: ["normal", "post_bid"],
    default: "normal",
    index: true,
  },

  vehicleNumber: { type: String, required: false },

  files: [fileSchema], // Array of file metadata

  createdAt: { type: Date, default: Date.now },
});

quotationSchema.index({ tender: 1, phase: 1, price: 1, createdAt: 1 });
quotationSchema.index({ tender: 1, transportUser: 1, phase: 1, createdAt: -1 });

export default mongoose.model("Quotation", quotationSchema);
