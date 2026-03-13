import mongoose from "mongoose";

const transporterVehicleSchema = new mongoose.Schema(
  {
    transportUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },

    catalogVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VehicleCatalog",
      default: null,
      index: true,
    },

    group: {
      type: String,
      trim: true,
      default: "",
    },

    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    subCategory: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    quantityOwned: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    source: {
      type: String,
      enum: ["catalog", "custom"],
      default: "catalog",
      index: true,
    },

    status: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved",
      index: true,
    },

    requestedByTransporter: {
      type: Boolean,
      default: false,
    },

    adminRemark: {
      type: String,
      trim: true,
      default: "",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

transporterVehicleSchema.index({ transportUser: 1, status: 1 });
transporterVehicleSchema.index({ transportUser: 1, catalogVehicleId: 1 });
transporterVehicleSchema.index({ transportUser: 1, category: 1, subCategory: 1 });

export default mongoose.model("TransporterVehicle", transporterVehicleSchema);