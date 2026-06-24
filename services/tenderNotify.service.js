import mongoose from "mongoose";
import moment from "moment-timezone";
import Tender from "../models/tenderSchema.js";
import User from "../models/userSchema.js";
import { sendWhatsAppTemplate } from "../utils/sendWhatsapp.js";

const getSafeNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const WHATSAPP_SEND_TIMEOUT_MS = getSafeNumber(
  process.env.WHATSAPP_SEND_TIMEOUT_MS,
  15000,
  5000,
  60000,
);

const WHATSAPP_SEND_CONCURRENCY = getSafeNumber(
  process.env.WHATSAPP_SEND_CONCURRENCY,
  5,
  1,
  20,
);

function sanitizeWhatsAppPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  // WhatsApp Cloud API expects international format without "+"
  // Example India: 91989595864
  return digits;
}

function isValidWhatsAppPhone(phone) {
  // E.164 max is 15 digits. Minimum practical length kept as 10.
  return /^[1-9]\d{9,14}$/.test(phone);
}

function getWhatsAppErrorMessage(error) {
  const metaError = error?.response?.data?.error;

  if (metaError?.message) {
    return [
      metaError.message,
      metaError.code ? `code: ${metaError.code}` : null,
      metaError.error_subcode ? `subcode: ${metaError.error_subcode}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  return error?.message || "Unknown WhatsApp send error";
}

function withTimeout(promise, timeoutMs, label = "Operation") {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  );

  await Promise.all(workers);
  return results;
}

async function sendWhatsAppToOneUser(user, values) {
  const rawPhone = user?.phone || "";

  if (!rawPhone) {
    return {
      userId: user._id,
      name: user.name || "",
      phone: null,
      status: "skipped",
      reason: "missing_phone",
    };
  }

  const phone = sanitizeWhatsAppPhone(rawPhone);

  if (!isValidWhatsAppPhone(phone)) {
    return {
      userId: user._id,
      name: user.name || "",
      phone: rawPhone,
      normalizedPhone: phone,
      status: "skipped",
      reason: "invalid_phone_format",
    };
  }

  try {
    const response = await withTimeout(
      sendWhatsAppTemplate(phone, values),
      WHATSAPP_SEND_TIMEOUT_MS,
      `WhatsApp send to ${phone}`,
    );

    return {
      userId: user._id,
      name: user.name || "",
      phone,
      status: "sent",
      whatsappResponse: response || null,
    };
  } catch (error) {
    console.error("[WHATSAPP] Failed for user:", {
      userId: String(user._id),
      name: user.name || "",
      phone,
      error: getWhatsAppErrorMessage(error),
    });

    return {
      userId: user._id,
      name: user.name || "",
      phone,
      status: "failed",
      error: getWhatsAppErrorMessage(error),
    };
  }
}

function formatPickupAsDispatch(tender) {
  // Prefer new schema pickup
  const p = tender?.pickup || null;
  if (p && typeof p === "object") {
    const text = [p.location, p.city, p.district, p.state]
      .filter(Boolean)
      .join(", ");
    const pin = p.pincode ? ` (${p.pincode})` : "";
    return (text || p.address || "Pickup") + pin;
  }

  // Legacy fallback
  const legacy = [tender.dispatchLocation, tender.address]
    .filter(Boolean)
    .join(", ");
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

  const tenderTransporters = Array.isArray(tender.transporters)
    ? tender.transporters
    : [];
  if (tenderTransporters.length === 0) {
    throw new Error("No transporters attached to this tender");
  }

  let targetIds = tenderTransporters.map(String);

  if (Array.isArray(transporterIds) && transporterIds.length > 0) {
    const override = transporterIds.filter((x) =>
      targetIds.includes(String(x)),
    );
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

    delivery_from: moment(tender?.deliveryWindow?.from)
      .tz(timezone)
      .format("DD MMM YYYY"),
    delivery_to: moment(tender?.deliveryWindow?.to)
      .tz(timezone)
      .format("DD MMM YYYY"),

    start_datetime: moment(tender?.biddingStart)
      .tz(timezone)
      .format("DD MMM YYYY, hh:mm A"),
    end_datetime: moment(tender?.biddingEnd)
      .tz(timezone)
      .format("DD MMM YYYY, hh:mm A"),

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

  // const results = [];
  // let sent = 0;
  // let skipped = 0;

  // for (const u of users) {
  //   if (!u.phone) {
  //     results.push({
  //       userId: u._id,
  //       name: u.name || "",
  //       status: "skipped",
  //       reason: "missing_phone",
  //     });
  //     skipped += 1;
  //     continue;
  //   }

  //   try {
  //     await sendWhatsAppTemplate(u.phone, values);
  //     results.push({
  //       userId: u._id,
  //       name: u.name || "",
  //       phone: u.phone,
  //       status: "sent",
  //     });
  //     sent += 1;
  //   } catch (e) {
  //     results.push({
  //       userId: u._id,
  //       name: u.name || "",
  //       phone: u.phone,
  //       status: "failed",
  //       error: e.message,
  //     });
  //   }
  // }

  const results = await runWithConcurrency(
    users,
    WHATSAPP_SEND_CONCURRENCY,
    async (user) => sendWhatsAppToOneUser(user, values),
  );

  const sent = results.filter((r) => r.status === "sent").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    success: true,
    tenderId,
    counts: {
      total: users.length,
      sent,
      skipped,
      failed,
    },
    valuesUsed: values,
    results,
  };

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
