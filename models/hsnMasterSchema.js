import mongoose from "mongoose";

const hsnMasterSchema = new mongoose.Schema(
  {
    codeDisplay: { type: String, required: true, trim: true }, // 2523.29.10
    codeDigits: { type: String, required: true, trim: true, index: true }, // 25232910
    description: { type: String, required: true, trim: true },
    page: { type: Number, default: null },
    source: { type: String, default: "HSN PDF" },
  },
  { timestamps: true }
);

hsnMasterSchema.index({ description: "text" });

export default mongoose.model("HsnMaster", hsnMasterSchema);