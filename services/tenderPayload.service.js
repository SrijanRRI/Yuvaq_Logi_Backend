import mongoose from "mongoose";
import moment from "moment-timezone";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const normalizeHsn = (value = "") => String(value).replace(/\D/g, "").trim();

const normalizeText = (value = "") => String(value || "").trim();

const normalizeLocation = (loc, label) => {
  const pincode = String(loc?.pincode || "").replace(/\D/g, "").slice(0, 6);
  const address = normalizeText(loc?.address);
  const location = normalizeText(loc?.location);
  const city = normalizeText(loc?.city);
  const district = normalizeText(loc?.district);
  const state = normalizeText(loc?.state);
  const country = normalizeText(loc?.country || "India");

  if (!pincode || pincode.length !== 6) {
    throw httpError(400, `${label} pincode must be 6 digits`);
  }

  if (!address) {
    throw httpError(400, `${label} address is required`);
  }

  return {
    pincode,
    address,
    location,
    city,
    district,
    state,
    country,
  };
};

const normalizeMaterials = (materials) => {
  if (!Array.isArray(materials) || materials.length === 0) return [];

  return materials.map((m, index) => {
    const hsnDigits = normalizeHsn(m?.hsnDigits || m?.hsnCode);
    const hsnCode = normalizeText(m?.hsnCode) || hsnDigits;
    const materialName = normalizeText(m?.materialName);

    if (!hsnDigits) {
      throw httpError(400, `Material #${index + 1}: HSN code is required`);
    }

    if (!materialName) {
      throw httpError(400, `Material #${index + 1}: material name is required`);
    }

    let quantity = null;
    if (m?.quantity !== undefined && m?.quantity !== null && m?.quantity !== "") {
      const q = Number(m.quantity);
      if (!Number.isFinite(q) || q < 0) {
        throw httpError(400, `Material #${index + 1}: quantity must be a valid number >= 0`);
      }
      quantity = q;
    }

    return {
      hsnCode,
      hsnDigits,
      materialName,
      quantity,
      unit: normalizeText(m?.unit),
      remarks: normalizeText(m?.remarks),
    };
  });
};

const normalizeTransporters = (transporters) => {
  if (!Array.isArray(transporters) || transporters.length === 0) {
    throw httpError(400, "At least one transporter is required");
  }

  const unique = [...new Set(transporters.map(String))];

  for (const id of unique) {
    if (!mongoose.isValidObjectId(id)) {
      throw httpError(400, "Invalid transporter id");
    }
  }

  return unique;
};

export function buildTenderPayloadFromBody(body, createdByUserId) {
  const {
    shipmentPlanId,
    pickup,
    drop,
    vehicleRequirements,
    materials,
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

  if (!Array.isArray(vehicleRequirements) || vehicleRequirements.length === 0) {
    throw httpError(400, "At least one vehicle requirement is required");
  }

  const normalizedPickup = normalizeLocation(pickup, "Pickup");
  const normalizedDrop = normalizeLocation(drop, "Drop");
  const normalizedMaterials = normalizeMaterials(materials);
  const normalizedTransporters = normalizeTransporters(transporters);

  const tw = Number(totalWeight);
  const tq = Number(totalQuantity);

  if (!Number.isFinite(tw) || tw <= 0) {
    throw httpError(400, "totalWeight must be a valid number > 0");
  }

  if (!Number.isFinite(tq) || tq <= 0) {
    throw httpError(400, "totalQuantity must be a valid number > 0");
  }

  let shipmentPlanRef = null;
  if (shipmentPlanId) {
    if (!mongoose.isValidObjectId(shipmentPlanId)) {
      throw httpError(400, "Invalid shipmentPlanId");
    }
    shipmentPlanRef = shipmentPlanId;
  }

  let priceDifferenceValue;
  if (priceDifference !== undefined && priceDifference !== null && priceDifference !== "") {
    const n = Number(priceDifference);
    if (!Number.isFinite(n) || n < 0) {
      throw httpError(400, "priceDifference must be a valid number >= 0");
    }
    priceDifferenceValue = n;
  }

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

  let utcCloseDate = null;
  try {
    const [year, month, day] = String(closeDate).split("-").map(Number);
    utcCloseDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(utcCloseDate.getTime())) throw new Error("bad");
  } catch {
    throw httpError(400, "closeDate must be a valid YYYY-MM-DD date");
  }

  const normalizedVehicles = vehicleRequirements.map((v) => ({
    vehicleId: v.vehicleId,
    category: normalizeText(v.category),
    subCategory: normalizeText(v.subCategory),
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

  const tenderPayload = {
    createdBy: createdByUserId,
    shipmentPlan: shipmentPlanRef || null,

    pickup: normalizedPickup,
    drop: normalizedDrop,

    materials: normalizedMaterials,
    vehicleRequirements: normalizedVehicles,
    transporters: normalizedTransporters,

    remarks: normalizeText(remarks),
    closeDate: utcCloseDate,

    biddingStart: utcBiddingStart,
    biddingEnd: utcBiddingSoftEnd,
    biddingSoftEnd: utcBiddingSoftEnd,
    biddingHardEnd: utcBiddingHardEnd,

    deliveryWindow: {
      from: utcDeliveryFrom,
      to: utcDeliveryTo,
    },

    totalWeight: tw,
    totalQuantity: tq,

    projectName: normalizeText(projectName),
    projectCode: normalizeText(projectCode),
    purchaseOrder: normalizeText(purchaseOrder),
    projectRemark: normalizeText(projectRemark),

    minBidAmount: minAmt,
    maxBidAmount: maxAmt,
    maxBidUnit: String(maxBidUnit),
  };

  if (priceDifferenceValue !== undefined) {
    tenderPayload.priceDifference = priceDifferenceValue;
  }

  return tenderPayload;
}