import mongoose, { Schema } from "mongoose";

const locationSchema = new Schema(
  {
    // auto-filled via pincode lookup (frontend) - user can still edit if you allow
    location: { type: String, trim: true, default: "" }, // locality/area/post office name etc.
    city: { type: String, trim: true, default: "" }, // city / block / subdivision (as you decide in FE)
    district: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },

    // required core
    pincode: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => /^\d{6}$/.test(String(v)),
        message: "Pincode must be 6 digits",
      },
    },

    // user-entered precise address (textarea)
    address: { type: String, required: true, trim: true },

    // optional: future-proof
    country: { type: String, trim: true, default: "India" },
  },
  { _id: false },
);

/* ---------------- Vehicle Requirement (Tender) ---------------- */
const vehicleRequirementSchema = new Schema(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "VehicleCatalog",
      required: true,
    },
    category: { type: String, required: true, trim: true }, // snapshot
    subCategory: { type: String, required: true, trim: true }, // snapshot
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);

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

    // Close date remains for tagging/reporting
    closeDate: { type: Date, required: true },

    // Bidding period support
    biddingStart: { type: Date, required: true },
    biddingEnd: { type: Date, required: true },

    pickup: { type: locationSchema, default: null },

    drop: { type: locationSchema, default: null },

    vehicleRequirements: {
      type: [vehicleRequirementSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one vehicle requirement is required",
      },
      required: true,
    },

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
      transporter: { type: Schema.Types.ObjectId, ref: "user", default: null },

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
          ref: "user",
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

    postBid: {
      enabled: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ["inactive", "active", "ended"],
        default: "inactive",
      },

      // RR user entered range
      rangeMin: { type: Number, default: null },
      rangeMax: { type: Number, default: null },

      // timing (endsAt MUST be biddingEnd + 10 min)
      startedAt: { type: Date, default: null },
      endsAt: { type: Date, default: null },

      // freeze eligible top3 at the moment RR starts post-bid
      eligibleTransporters: [
        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      ],

      notifiedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

tenderSchema.index({ "postBid.status": 1, "postBid.endsAt": 1 });
tenderSchema.index({ biddingEnd: 1 });

tenderSchema.index({ "pickup.pincode": 1 });
tenderSchema.index({ "drop.pincode": 1 });
tenderSchema.index({ "pickup.state": 1, "pickup.district": 1 });
tenderSchema.index({ "drop.state": 1, "drop.district": 1 });

tenderSchema.index({ "vehicleRequirements.vehicleId": 1 });
tenderSchema.index({ "vehicleRequirements.category": 1 });
tenderSchema.index({ "vehicleRequirements.subCategory": 1 });

export default mongoose.model("Tender", tenderSchema);
