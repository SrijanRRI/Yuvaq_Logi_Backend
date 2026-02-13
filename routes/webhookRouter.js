import express from "express";
import { razorpayWebhook } from "../controller/tenderPaymentController.js";

const router = express.Router();

router.post("/razorpay", razorpayWebhook);

export default router;
