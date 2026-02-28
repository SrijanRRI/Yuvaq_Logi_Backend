import mongoose from "mongoose";
import moment from "moment-timezone";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function buildTenderPayloadFromBody(body, createdByUserId) {
  const {
    shipmentPlanId,
    pickup,
    drop,
    vehicleRequirements,
    transporters,
    remarks,
    closeDate,
    deliveryWindow,
    biddingStart,
    biddingEnd,
    biddingHardEnd,
    totalWeight,
    totalQuantity,
    projectName,
    projectCode,
    purchaseOrder,
    projectRemark,
    priceDifference,
    maxBidAmount,
    maxBidUnit,
    minBidAmount,
  } = body || {};

  // -------------------- Basic validations --------------------
  if (!projectName || !projectCode || !purchaseOrder) {
    throw httpError(400, "Project name, code and PO are required");
  }

  if (!closeDate) {
    throw httpError(400, "Closing date is required");
  }

  if (!biddingStart || !biddingEnd) {
    throw httpError(400, "Bidding start and end time are required");
  }

  if (!deliveryWindow?.from || !deliveryWindow?.to) {
    throw httpError(400, "Delivery window (from and to dates) is required");
  }

  if (!pickup?.pincode || !pickup?.address) {
    throw httpError(400, "Pickup pincode and address are required");
  }

  if (!drop?.pincode || !drop?.address) {
    throw httpError(400, "Drop pincode and address are required");
  }

  if (!Array.isArray(vehicleRequirements) || vehicleRequirements.length === 0) {
    throw httpError(400, "At least one vehicle requirement is required");
  }

  if (!Array.isArray(transporters) || transporters.length === 0) {
    throw httpError(400, "At least one transporter is required");
  }

  // totals (your schema requires these)
  const tw = Number(totalWeight);
  const tq = Number(totalQuantity);
  if (!Number.isFinite(tw) || tw <= 0) {
    throw httpError(400, "totalWeight must be a valid number > 0");
  }
  if (!Number.isFinite(tq) || tq <= 0) {
    throw httpError(400, "totalQuantity must be a valid number > 0");
  }

  // optional shipmentPlanId
  let shipmentPlanRef = null;
  if (shipmentPlanId) {
    if (!mongoose.isValidObjectId(shipmentPlanId)) {
      throw httpError(400, "Invalid shipmentPlanId");
    }
    shipmentPlanRef = shipmentPlanId;
  }

  // priceDifference optional
  let priceDifferenceValue;
  if (priceDifference !== undefined && priceDifference !== null && priceDifference !== "") {
    const n = Number(priceDifference);
    if (!Number.isFinite(n) || n < 0) {
      throw httpError(400, "priceDifference must be a valid number >= 0");
    }
    priceDifferenceValue = n;
  }

  // -------------------- Time conversions (IST → UTC) --------------------
  const timezone = "Asia/Kolkata";

  const utcBiddingStart = moment.tz(biddingStart, timezone).utc().toDate();
  const utcBiddingEnd = moment.tz(biddingEnd, timezone).utc().toDate();
  const utcBiddingSoftEnd = utcBiddingEnd;

  const utcBiddingHardEnd = biddingHardEnd
    ? moment.tz(biddingHardEnd, timezone).utc().toDate()
    : utcBiddingEnd;

  if (utcBiddingHardEnd.getTime() < utcBiddingSoftEnd.getTime()) {
    throw httpError(400, "biddingHardEnd must be >= biddingEnd (soft end)");
  }

  const utcDeliveryFrom = moment.tz(deliveryWindow.from, timezone).utc().toDate();
  const utcDeliveryTo = moment.tz(deliveryWindow.to, timezone).utc().toDate();

  // Close date parse: YYYY-MM-DD → UTC midnight
  let utcCloseDate = null;
  try {
    const [year, month, day] = String(closeDate).split("-").map(Number);
    utcCloseDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(utcCloseDate.getTime())) throw new Error("bad");
  } catch {
    throw httpError(400, "closeDate must be a valid YYYY-MM-DD date");
  }

  // -------------------- Normalize vehicle requirements --------------------
  const normalizedVehicles = vehicleRequirements.map((v) => ({
    vehicleId: v.vehicleId,
    category: String(v.category || "").trim(),
    subCategory: String(v.subCategory || "").trim(),
    quantity: Number(v.quantity || 1),
  }));

  for (const v of normalizedVehicles) {
    if (!v.vehicleId || !mongoose.isValidObjectId(v.vehicleId)) {
      throw httpError(400, "Valid vehicleId is required for each vehicle requirement");
    }
    if (!v.category || !v.subCategory) {
      throw httpError(400, "Each vehicle requirement must include category and subCategory");
    }
    if (!Number.isFinite(v.quantity) || v.quantity < 1) {
      throw httpError(400, "Vehicle quantity must be a number >= 1");
    }
  }

  // -------------------- Bid limits --------------------
  const minAmt = Number(minBidAmount);
  const maxAmt = Number(maxBidAmount);

  if (!Number.isFinite(maxAmt) || maxAmt <= 0) {
    throw httpError(400, "maxBidAmount must be a valid number > 0");
  }
  if (!Number.isFinite(minAmt) || minAmt < 0) {
    throw httpError(400, "minBidAmount must be a valid number >= 0");
  }

  const allowedUnits = ["Per MT", "Per Tender"];
  if (!maxBidUnit || !allowedUnits.includes(String(maxBidUnit))) {
    throw httpError(400, "maxBidUnit is required and must be Per MT or Per Tender");
  }
  if (minAmt > maxAmt) {
    throw httpError(400, "minBidAmount cannot be greater than maxBidAmount");
  }

  // -------------------- Final payload --------------------
  const tenderPayload = {
    createdBy: createdByUserId,
    shipmentPlan: shipmentPlanRef || null,
    pickup,
    drop,
    vehicleRequirements: normalizedVehicles,
    transporters,
    remarks: remarks || "",
    closeDate: utcCloseDate,

    biddingStart: utcBiddingStart,
    biddingEnd: utcBiddingSoftEnd,

    biddingSoftEnd: utcBiddingSoftEnd,
    biddingHardEnd: utcBiddingHardEnd,

    deliveryWindow: { from: utcDeliveryFrom, to: utcDeliveryTo },

    totalWeight: tw,
    totalQuantity: tq,

    projectName,
    projectCode,
    purchaseOrder,
    projectRemark: projectRemark || "",

    minBidAmount: minAmt,
    maxBidAmount: maxAmt,
    maxBidUnit: String(maxBidUnit),
  };

  if (priceDifferenceValue !== undefined) {
    tenderPayload.priceDifference = priceDifferenceValue;
  }

  return tenderPayload;
}