import express from "express";
import {
  createTender,
  getAllTendersByRRUser,
  getTendersForTransporter,
  getSingleTender,
  getTenderQuotations,
  finalizeTender,
  deleteTender,
  getMyQuotationPosition,
  getUpcomingTendersForTransporter,
  reopenTender,
  getQuotationHistoryForTransporter,
  notifyTenderTransporters,
  getFinalizedTransporterContact,
  requestSelectionConfirmation,
  respondSelectionConfirmation,
  getPendingConfirmationsForTransporter,
  // getAllFinalizedTendersWithQuotations
} from "../controller/tenderController.js";

import { createFinalizeOrder, createSelectionAcceptFeeOrder, verifyFinalizePayment, verifySelectionAcceptFeePayment } from "../controller/tenderPaymentController.js";
import { jwtAuth } from "../middleware/jwtAuth.js";

import { getActivePostBidForTransporter, startPostBidNegotiation } from "../controller/postBidController.js";
import { subscriptionGate } from "../middleware/subscriptionGate.js";

const router = express.Router();

// ✅ 1. Create a new tender (RR user)
router.post("/create-tender", jwtAuth, subscriptionGate, createTender);

// ✅ 2. Get all tenders created by RR user
router.get("/my-tenders", jwtAuth, subscriptionGate, getAllTendersByRRUser);

// ✅ Get the transporter details"
router.get("/transporter-contact/:id/finalized-contact", jwtAuth, getFinalizedTransporterContact);

// ✅ 3. Get all tenders assigned to a transporter
router.get("/assigned", jwtAuth, subscriptionGate, getTendersForTransporter);

// ✅ 4. Get single tender by ID
router.get("/:id", jwtAuth, subscriptionGate, getSingleTender);

// ✅ 5. Get quotations for a tender
router.get("/quotations/:id", jwtAuth, subscriptionGate, getTenderQuotations);

// ✅ 6. Finalize a tender (choose a quotation)
router.put("/finalize/:id", jwtAuth, finalizeTender);

// ✅ 7. Delete a tender (by RR user)
router.delete("/:id", jwtAuth, deleteTender);

router.get("/quotation/history", jwtAuth, subscriptionGate, getQuotationHistoryForTransporter);

// router.get("/my-finalized-tenders", jwtAuth, getAllFinalizedTendersWithQuotations);

router.get("/my-position/:tenderId", jwtAuth, getMyQuotationPosition);

router.get("/transporter/upcoming", jwtAuth, getUpcomingTendersForTransporter);

router.post("/reopen/:id", jwtAuth, reopenTender);

router.post("/:id/notify", notifyTenderTransporters);

router.post("/:id/finalize/payment/order", jwtAuth, subscriptionGate, createFinalizeOrder);

router.post("/:id/finalize/payment/verify", jwtAuth, subscriptionGate, verifyFinalizePayment);

// RR user asks transporter to confirm
router.post("/:id/selection/request", jwtAuth, subscriptionGate, requestSelectionConfirmation);

// Transporter accepts/rejects
router.post("/:id/selection/respond", jwtAuth, subscriptionGate, respondSelectionConfirmation);

// Transporter can list pending confirmations
router.get("/transporter/pending-confirmations", jwtAuth, subscriptionGate, getPendingConfirmationsForTransporter);

// transporter accept fee (order + verify)
router.post("/:id/selection/accept/payment/order", jwtAuth, subscriptionGate, createSelectionAcceptFeeOrder);

router.post("/:id/selection/accept/payment/verify", jwtAuth, subscriptionGate, verifySelectionAcceptFeePayment);

// Post Bid Negotiation : 
router.post("/:id/post-bid/start", jwtAuth, subscriptionGate, startPostBidNegotiation);

// transporter dashboard: list active post-bids for me
router.get("/transporter/post-bid-active", jwtAuth, subscriptionGate, getActivePostBidForTransporter);

export default router;
