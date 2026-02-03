import express from "express";
import { razorpayWebhook } from "../controller/paymentController.js";

const router = express.Router();

router.post("/razorpay", razorpayWebhook);

export default router;
