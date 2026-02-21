import express from "express";
import { jwtAuth } from "../middleware/jwtAuth.js";
import {
  getMySubscription,
  getSubscriptionPlans,
  createSubscriptionOrder,
  verifySubscriptionPayment,
} from "../controller/subscriptionController.js";

const router = express.Router();

router.get("/plans", getSubscriptionPlans);          // can be public
router.get("/me", jwtAuth, getMySubscription);       // auth needed
router.post("/order", jwtAuth, createSubscriptionOrder);
router.post("/verify", jwtAuth, verifySubscriptionPayment);

export default router;