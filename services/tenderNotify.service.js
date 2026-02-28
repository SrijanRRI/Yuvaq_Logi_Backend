import mongoose from "mongoose";
import moment from "moment-timezone";
import Tender from "../models/tenderSchema.js";
import User from "../models/userSchema.js";
import { sendWhatsAppTemplate } from "../utils/sendWhatsapp.js";

function formatPickupAsDispatch(tender) {
  // Prefer new schema pickup
  const p = tender?.pickup || null;
  if (p && typeof p === "object") {
    const text = [p.location, p.city, p.district, p.state].filter(Boolean).join(", ");
    const pin = p.pincode ? ` (${p.pincode})` : "";
    return (text || p.address || "Pickup") + pin;
  }

  // Legacy fallback
  const legacy = [tender.dispatchLocation, tender.address].filter(Boolean).join(", ");
  const pin = tender.pincode ? ` (${tender.pincode})` : "";
  return (legacy || "Dispatch") + pin;
}

/**
 * Internal notifier used by BOTH:
 * - Route controller /:id/notify
 * - Draft-finalize cron job
 */
export async function notifyTenderTransportersInternal(tenderId, opts = {}) {
  const { transporterIds = [], dryRun = false } = opts || {};

  if (!mongoose.isValidObjectId(tenderId)) {
    throw new Error("Invalid tender id");
  }

  const tender = await Tender.findById(tenderId).lean();
  if (!tender) throw new Error("Tender not found");

  const tenderTransporters = Array.isArray(tender.transporters) ? tender.transporters : [];
  if (tenderTransporters.length === 0) {
    throw new Error("No transporters attached to this tender");
  }

  let targetIds = tenderTransporters.map(String);

  if (Array.isArray(transporterIds) && transporterIds.length > 0) {
    const override = transporterIds.filter((x) => targetIds.includes(String(x)));
    if (override.length === 0) {
      throw new Error("Provided transporterIds are not part of this tender");
    }
    targetIds = override;
  }

  const users = await User.find({
    _id: { $in: targetIds.map((x) => new mongoose.Types.ObjectId(x)) },
  })
    .select("_id name phone")
    .lean();

  const timezone = "Asia/Kolkata";

  const values = {
    dispatch_location: formatPickupAsDispatch(tender),

    delivery_from: moment(tender?.deliveryWindow?.from).tz(timezone).format("DD MMM YYYY"),
    delivery_to: moment(tender?.deliveryWindow?.to).tz(timezone).format("DD MMM YYYY"),

    start_datetime: moment(tender?.biddingStart).tz(timezone).format("DD MMM YYYY, hh:mm A"),
    end_datetime: moment(tender?.biddingEnd).tz(timezone).format("DD MMM YYYY, hh:mm A"),

    // optional extra values (safe even if template ignores)
    project_name: tender.projectName || "",
    project_code: tender.projectCode || "",
    purchase_order: tender.purchaseOrder || "",
  };

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      templatePreview: values,
      recipientsPreview: users.map((u) => ({
        id: u._id,
        name: u.name,
        phone: u.phone || null,
      })),
    };
  }

  const results = [];
  let sent = 0;
  let skipped = 0;

  for (const u of users) {
    if (!u.phone) {
      results.push({
        userId: u._id,
        name: u.name || "",
        status: "skipped",
        reason: "missing_phone",
      });
      skipped += 1;
      continue;
    }

    try {
      await sendWhatsAppTemplate(u.phone, values);
      results.push({ userId: u._id, name: u.name || "", phone: u.phone, status: "sent" });
      sent += 1;
    } catch (e) {
      results.push({
        userId: u._id,
        name: u.name || "",
        phone: u.phone,
        status: "failed",
        error: e.message,
      });
    }
  }

  return {
    success: true,
    tenderId,
    counts: {
      total: users.length,
      sent,
      skipped,
      failed: results.filter((r) => r.status === "failed").length,
    },
    valuesUsed: values,
    results,
  };
}