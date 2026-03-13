import express from "express";
import { jwtAuth } from "../middleware/jwtAuth.js";
import {
  submitFeedback,
  getMyFeedbacks,
  getAdminFeedbacks,
  updateFeedbackStatus,
  getAdminFeedbackStats,
} from "../controller/feedbackController.js";

const router = express.Router();

// User routes
router.post("/", jwtAuth, submitFeedback);
router.get("/my", jwtAuth, getMyFeedbacks);

// Admin routes
router.get("/admin/list", jwtAuth, getAdminFeedbacks);
router.get("/admin/stats", jwtAuth, getAdminFeedbackStats);
router.patch("/admin/:id/status", jwtAuth, updateFeedbackStatus);

export default router;