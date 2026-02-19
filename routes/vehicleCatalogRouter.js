import express from "express";
import { getVehicleCatalog } from "../controller/vehicleCatalogController.js";
import jwtAuth from "../middleware/jwtAuth.js";
import { subscriptionGate } from "../middleware/subscriptionGate.js";

const router = express.Router();

// GET /vehicle-catalog
router.get("/vehicle-catalog", jwtAuth, subscriptionGate, getVehicleCatalog);

export default router;