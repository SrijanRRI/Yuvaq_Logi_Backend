import express from "express";
import { jwtAuth } from "../middleware/jwtAuth.js";
import { lookupHsnByCode, searchHsn } from "../controller/hsnController.js";

const router = express.Router();

router.get("/lookup/:code", jwtAuth, lookupHsnByCode);
router.get("/search", jwtAuth, searchHsn);

export default router;