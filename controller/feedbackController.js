import Feedback from "../models/feedbackSchema.js";
import userModel from "../models/userSchema.js";

const FEEDBACK_COOLDOWN_MINUTES = 15;
const FEEDBACK_MAX_PER_24H = 3;
const DUPLICATE_BLOCK_DAYS = 30;

const ALLOWED_CATEGORIES = new Set([
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
]);

const ALLOWED_MODULES = new Set([
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
]);

const ALLOWED_STATUSES = new Set([
  "new",
  "reviewed",
  "planned",
  "resolved",
  "ignored",
]);

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdmin(req) {
  return req?.user?.role === "admin";
}

function getUserId(req) {
  return req?.user?.id || req?.user?._id || null;
}

export const submitFeedback = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    let {
      rating,
      title = "",
      review,
      category = "general",
      module = "profile",
      source = "profile",
      contactAllowed = true,
    } = req.body || {};

    rating = Number(rating);
    title = String(title || "").trim();
    review = String(review || "").trim();
    category = String(category || "general").trim();
    module = String(module || "profile").trim();
    source = String(source || "profile").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be an integer between 1 and 5.",
      });
    }

    if (!review || review.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Review must be at least 10 characters long.",
      });
    }

    if (review.length > 1500) {
      return res.status(400).json({
        success: false,
        message: "Review cannot exceed 1500 characters.",
      });
    }

    if (title.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Title cannot exceed 120 characters.",
      });
    }

    if (!ALLOWED_CATEGORIES.has(category)) {
      category = "other";
    }

    if (!ALLOWED_MODULES.has(module)) {
      module = "other";
    }

    if (!["profile", "dashboard", "other"].includes(source)) {
      source = "other";
    }

    const user = await userModel
      .findById(userId)
      .select("name email phone role")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const now = new Date();
    const cooldownSince = new Date(now.getTime() - FEEDBACK_COOLDOWN_MINUTES * 60 * 1000);
    const daySince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const duplicateSince = new Date(now.getTime() - DUPLICATE_BLOCK_DAYS * 24 * 60 * 60 * 1000);

    const normalizedReview = normalizeText(review);

    const [recentFeedback, dailyCount, duplicateFeedback] = await Promise.all([
      Feedback.findOne({
        userId,
        createdAt: { $gte: cooldownSince },
      })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean(),

      Feedback.countDocuments({
        userId,
        createdAt: { $gte: daySince },
      }),

      Feedback.findOne({
        userId,
        normalizedReview,
        rating,
        category,
        module,
        createdAt: { $gte: duplicateSince },
      })
        .select("_id createdAt")
        .lean(),
    ]);

    if (recentFeedback) {
      const nextAllowedAt = new Date(
        new Date(recentFeedback.createdAt).getTime() + FEEDBACK_COOLDOWN_MINUTES * 60 * 1000
      );

      return res.status(429).json({
        success: false,
        message: `Please wait before submitting another feedback.`,
        nextAllowedAt,
      });
    }

    if (dailyCount >= FEEDBACK_MAX_PER_24H) {
      return res.status(429).json({
        success: false,
        message: `You have reached the feedback limit for the last 24 hours.`,
      });
    }

    if (duplicateFeedback) {
      return res.status(409).json({
        success: false,
        message: "Same feedback has already been submitted recently.",
      });
    }

    const created = await Feedback.create({
      userId,
      submittedBy: {
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        role: user.role || "user",
      },
      rating,
      title,
      review,
      category,
      module,
      source,
      contactAllowed: Boolean(contactAllowed),
      meta: {
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully.",
      data: created,
    });
  } catch (error) {
    console.error("submitFeedback error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit feedback.",
    });
  }
};

export const getMyFeedbacks = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const [items, totalCount] = await Promise.all([
      Feedback.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Feedback.countDocuments({ userId }),
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (error) {
    console.error("getMyFeedbacks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load feedback history.",
    });
  }
};

export const getAdminFeedbacks = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "Only admin can access feedback list.",
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const {
      status,
      category,
      module,
      role,
      rating,
      q,
    } = req.query || {};

    const filter = {};

    if (status && ALLOWED_STATUSES.has(status)) {
      filter.status = status;
    }

    if (category && ALLOWED_CATEGORIES.has(category)) {
      filter.category = category;
    }

    if (module && ALLOWED_MODULES.has(module)) {
      filter.module = module;
    }

    if (role && ["user", "admin", "transportUser"].includes(role)) {
      filter["submittedBy.role"] = role;
    }

    if (rating && !Number.isNaN(Number(rating))) {
      filter.rating = Number(rating);
    }

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), "i");
      filter.$or = [
        { title: regex },
        { review: regex },
        { "submittedBy.name": regex },
        { "submittedBy.email": regex },
        { "submittedBy.phone": regex },
      ];
    }

    const [items, totalCount] = await Promise.all([
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Feedback.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (error) {
    console.error("getAdminFeedbacks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load admin feedback list.",
    });
  }
};

export const updateFeedbackStatus = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "Only admin can update feedback status.",
      });
    }

    const { id } = req.params;
    let { status, adminRemark = "" } = req.body || {};

    status = String(status || "").trim();
    adminRemark = String(adminRemark || "").trim();

    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feedback status.",
      });
    }

    if (adminRemark.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Admin remark cannot exceed 1000 characters.",
      });
    }

    const updated = await Feedback.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          adminRemark,
          reviewedBy: getUserId(req),
          reviewedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Feedback status updated successfully.",
      data: updated,
    });
  } catch (error) {
    console.error("updateFeedbackStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update feedback status.",
    });
  }
};

export const getAdminFeedbackStats = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "Only admin can access feedback stats.",
      });
    }

    const [overview, byRating, byCategory, byModule, byStatus] = await Promise.all([
      Feedback.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            averageRating: { $avg: "$rating" },
          },
        },
      ]),
      Feedback.aggregate([
        {
          $group: {
            _id: "$rating",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Feedback.aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Feedback.aggregate([
        {
          $group: {
            _id: "$module",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Feedback.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        overview: overview[0] || { total: 0, averageRating: 0 },
        byRating,
        byCategory,
        byModule,
        byStatus,
      },
    });
  } catch (error) {
    console.error("getAdminFeedbackStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load feedback stats.",
    });
  }
};