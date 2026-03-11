import express from "express";
import { getVehicleCatalog } from "../controller/vehicleCatalogController.js";
import jwtAuth from "../middleware/jwtAuth.js";
import { subscriptionGate } from "../middleware/subscriptionGate.js";
import { addCatalogVehicleToMyFleet, createCustomVehicleRequest, deleteMyFleetVehicle, getMyFleet } from "../controller/transporterVehicleController.js";

const router = express.Router();

// GET /vehicle-catalog
router.get("/vehicle-catalog", jwtAuth, subscriptionGate, getVehicleCatalog);

// transporter fleet
router.get("/my-fleet", jwtAuth, getMyFleet);
router.post("/my-fleet/catalog", jwtAuth, addCatalogVehicleToMyFleet);
router.post("/my-fleet/custom-request", jwtAuth, createCustomVehicleRequest);
router.delete("/my-fleet/:id", jwtAuth, deleteMyFleetVehicle);

export default router;
