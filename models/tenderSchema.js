import mongoose, { Schema } from "mongoose";

const tenderSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    shipmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShipmentPlanning", // <-- matches your model name
      default: null, // optional; not required
    },

    deliveryWindow: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },

    // 🆕 Close date remains for tagging/reporting
    closeDate: { type: Date, required: true },

    // 🆕 Bidding period support
    biddingStart: { type: Date, required: true },
    biddingEnd: { type: Date, required: true },

    dispatchLocation: { type: String, required: true },
    address: { type: String, required: true },
    pincode: { type: String, required: true },

    materials: [
      {
        material: { type: String, required: true },
        subMaterial: { type: String, default: "", trim: true },
        weight: { type: Number },
        quantity: { type: Number },
      },
    ],

    totalWeight: { type: Number, required: true },
    totalQuantity: { type: Number, required: true },

    remarks: { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: ["open", "quoted", "finalized", "closed"],
      default: "open",
    },

    transporters: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
      },
    ],

    quotations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Quotation",
      },
    ],

    selectedQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quotation",
    },

    finalPrice: {
      type: Number,
      required: function () {
        return this.status === "finalized" || this.status === "closed";
      },
    },

    minBidAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    maxBidAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    maxBidUnit: {
      type: String,
      enum: ["Per MT", "Per Tender"],
      required: true,
      trim: true,
    },

    // 🆕 Final winner (auto or manually selected)
    finalTransporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },

    // 🆕 Reason for selection or reopen
    winnerComment: {
      type: String,
      default: "",
      trim: true,
    },
    reopenCount: {
      type: Number,
      default: 0,
    },
    priceDifference: {
      type: Number, // numeric value
      default: 0, // or null if you prefer: default: null
      min: 0, // uncomment if you never want negatives
    },
    projectName: { type: String, required: true },
    projectCode: { type: String, required: true },
    purchaseOrder: { type: String, required: true, trim: true },
    projectRemark: { type: String, default: "", trim: true },

    selection: {
      status: {
        type: String,
        enum: ["none", "pending", "confirmed", "rejected"],
        default: "none",
      },
      quotation: {
        type: Schema.Types.ObjectId,
        ref: "Quotation",
        default: null,
      },
      transporter: { type: Schema.Types.ObjectId, ref: "User", default: null },

      requestedAt: { type: Date, default: null },
      respondedAt: { type: Date, default: null },

      response: {
        type: String,
        enum: ["accepted", "rejected", null],
        default: null,
      },
      rejectReason: { type: String, default: "" }, // transporter reject reason OR rr reopen reason (latest)
    },

    selectionHistory: [
      {
        quotation: {
          type: Schema.Types.ObjectId,
          ref: "Quotation",
          default: null,
        },
        transporter: {
          type: Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },

        action: {
          type: String,
          enum: ["request", "accept", "reject", "reopen", "remove"],
          required: true,
        },

        status: {
          type: String,
          enum: ["pending", "confirmed", "rejected", "reopened"],
          required: true,
        },

        reason: { type: String, default: "" }, // reject/reopen/remove reason
        byRole: {
          type: String,
          enum: ["rr", "transporter", "system"],
          default: "rr",
        },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model("Tender", tenderSchema);
