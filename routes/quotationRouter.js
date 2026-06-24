import express from "express";
import { submitQuotation } from "../controller/quotationController.js";
import { jwtAuth } from "../middleware/jwtAuth.js";
import { upload } from "../middleware/uploadMiddleware.js"; // multer
import { getMyQuotationsForTender } from "../controller/quotationController.js";
import { submitPostBidQuotation } from "../controller/postBidController.js";
import { subscriptionGate } from "../middleware/subscriptionGate.js";

const router = express.Router();

router.post("/submit/:id", jwtAuth, subscriptionGate, upload.single("file"), submitQuotation);
router.get("/my-tender-quotes/:tenderId", jwtAuth, subscriptionGate, getMyQuotationsForTender);

router.post("/post-bid/submit/:tenderId", jwtAuth, subscriptionGate, upload.single("file"), submitPostBidQuotation);

export default router;
