import mongoose from "mongoose";

const FEEDBACK_CATEGORIES = [
  "general",
  "bug",
  "ui_ux",
  "performance",
  "feature_request",
  "profile",
  "fleet_management",
  "upcoming_tenders",
  "live_bidding",
  "post_bid",
  "confirmations",
  "history",
  "draft_tenders",
  "shipment_planning",
  "subscription",
  "payment",
  "notification",
  "other",
];

const FEEDBACK_MODULES = [
  "profile",
  "dashboard",
  "fleet",
  "upcoming_tenders",
  "live_bidding",
  "post_bid",
  "confirmations",
  "history",
  "draft_tenders",
  "shipment_planning",
  "subscription",
  "payment",
  "notification",
  "general",
  "other",
];

const FEEDBACK_STATUSES = [
  "new",
  "reviewed",
  "planned",
  "resolved",
  "ignored",
];

const feedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },

    submittedBy: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
      role: {
        type: String,
        enum: ["user", "admin", "transportUser"],
        required: true,
      },
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },

    review: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1500,
    },

    normalizedReview: {
      type: String,
      default: "",
      select: false,
    },

    category: {
      type: String,
      enum: FEEDBACK_CATEGORIES,
      default: "general",
      index: true,
    },

    module: {
      type: String,
      enum: FEEDBACK_MODULES,
      default: "profile",
      index: true,
    },

    source: {
      type: String,
      enum: ["profile", "dashboard", "other"],
      default: "profile",
      index: true,
    },

    status: {
      type: String,
      enum: FEEDBACK_STATUSES,
      default: "new",
      index: true,
    },

    adminRemark: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    contactAllowed: {
      type: Boolean,
      default: true,
    },

    meta: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
  }
);

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

feedbackSchema.pre("validate", function (next) {
  if (this.title) {
    this.title = this.title.trim();
  }

  if (this.review) {
    this.review = this.review.trim();
    this.normalizedReview = normalizeText(this.review);
  }

  next();
});

feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ category: 1, module: 1, rating: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1, normalizedReview: 1, createdAt: -1 });

feedbackSchema.set("toJSON", {
  transform: function (_doc, ret) {
    delete ret.normalizedReview;
    return ret;
  },
});

feedbackSchema.set("toObject", {
  transform: function (_doc, ret) {
    delete ret.normalizedReview;
    return ret;
  },
});

const Feedback = mongoose.model("Feedback", feedbackSchema);
export default Feedback;