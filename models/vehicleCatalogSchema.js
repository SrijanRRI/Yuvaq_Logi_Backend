import mongoose, { Schema } from "mongoose";

const vehicleCatalogSchema = new Schema(
  {
    group: { type: String, trim: true, default: "" }, // e.g. "LCV", "HCV", "Trailer Trucks"
    category: { type: String, required: true, trim: true, index: true }, // e.g. "Light Commercial Vehicles (LCV)"
    subCategory: { type: String, required: true, trim: true }, // e.g. "Tata 407"

    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// unique vehicle entry (prevents duplicate rows)
vehicleCatalogSchema.index({ category: 1, subCategory: 1 }, { unique: true });

export default mongoose.model("VehicleCatalog", vehicleCatalogSchema);