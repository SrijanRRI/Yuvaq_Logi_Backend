// routes/quotationRoutes.js
import express from "express";
import { submitQuotation } from "../controller/quotationController.js";
import { jwtAuth } from "../middleware/jwtAuth.js";
import { upload } from "../middleware/uploadMiddleware.js"; // multer
import { getMyQuotationsForTender } from "../controller/quotationController.js";
import { submitPostBidQuotation } from "../controller/postBidController.js";

const router = express.Router();

router.post("/submit/:id", jwtAuth, upload.single("file"), submitQuotation);
router.get("/my-tender-quotes/:tenderId", jwtAuth, getMyQuotationsForTender);

router.post("/post-bid/submit/:tenderId", jwtAuth, upload.single("file"), submitPostBidQuotation);

export default router;
