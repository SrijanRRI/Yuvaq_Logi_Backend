import mongoose from "mongoose";
import moment from "moment-timezone";

import Tender from "../models/tenderSchema.js";
import Quotation from "../models/quotationSchema.js";
import userModel from "../models/userSchema.js";
import { sendMail } from "../utils/sendMail.js";

const timezone = "Asia/Kolkata";

const asId = (x) => {
  if (!x) return "";
  if (typeof x === "object") return String(x._id || x.id || "");
  return String(x);
};

const sortByPriceThenTime = (a, b) => {
  const pa = Number(a?.price ?? Infinity);
  const pb = Number(b?.price ?? Infinity);

  if (pa !== pb) return pa - pb;

  const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;

  return ta - tb;
};

const isPostBidQuote = (q) => {
  const phase = String(q?.phase || q?.source || q?.bidType || "").toLowerCase();

  return ["post_bid", "postbid", "post-bid", "improved"].includes(phase);
};

const bestByTransporter = (quotes = []) => {
  const map = new Map();

  const sorted = quotes.slice().sort(sortByPriceThenTime);

  for (const q of sorted) {
    const tid = asId(q.transportUser);
    if (!tid) continue;

    if (!map.has(tid)) {
      map.set(tid, q);
    }
  }

  return map;
};

const hasAnySelectionHistory = (tender) => {
  if (!Array.isArray(tender?.selectionHistory)) return false;

  return tender.selectionHistory.some((h) =>
    ["request", "accept", "reject", "reopen", "remove"].includes(
      String(h?.action || "").toLowerCase(),
    ),
  );
};

const getAutoWinnerQuotation = async (tender) => {
  const quotes = await Quotation.find({
    tender: tender._id,
  })
    .sort({ price: 1, createdAt: 1 })
    .lean();

  if (!quotes.length) return null;

  const normalQuotes = [];
  const postBidQuotes = [];

  for (const q of quotes) {
    if (isPostBidQuote(q)) {
      postBidQuotes.push(q);
    } else {
      normalQuotes.push(q);
    }
  }

  const bestNormal = bestByTransporter(normalQuotes);
  const bestPostBid = bestByTransporter(postBidQuotes);

  const transporterIds = new Set([
    ...bestNormal.keys(),
    ...bestPostBid.keys(),
  ]);

  const effectiveQuotes = [];

  for (const tid of transporterIds) {
    // If transporter submitted post-bid, post-bid quote becomes effective.
    // Otherwise normal quote remains effective.
    const q = bestPostBid.get(tid) || bestNormal.get(tid);
    if (q) effectiveQuotes.push(q);
  }

  effectiveQuotes.sort(sortByPriceThenTime);

  return effectiveQuotes[0] || null;
};

const sendSelectionRequestEmail = async ({ tender, quotation }) => {
  try {
    const transporter = await userModel.findById(quotation.transportUser).lean();

    if (!transporter?.email) {
      return {
        sent: false,
        reason: "missing_transporter_email",
      };
    }

    await sendMail({
      to: transporter.email,
      subject: "Your Quotation is Selected — Please Confirm (LogiQ)",
      html: `
        <div style="font-family:Arial;line-height:1.5">
          <h2 style="margin:0 0 10px;color:#059669">LogiQ</h2>

          <p>Hello <b>${transporter.name || "Transporter"}</b>,</p>

          <p>
            Your quotation has been selected for the tender below.
            Please open your Transporter Dashboard and <b>Accept/Reject</b>.
          </p>

          <table cellpadding="6" style="border:1px solid #e5e7eb;border-radius:8px">
            <tr>
              <td><b>Project</b></td>
              <td>${tender.projectName || "-"}</td>
            </tr>

            <tr>
              <td><b>Pickup</b></td>
              <td>${
                [
                  tender.pickup?.address,
                  tender.pickup?.city,
                  tender.pickup?.district,
                  tender.pickup?.state,
                  tender.pickup?.pincode,
                ]
                  .filter(Boolean)
                  .join(", ") || "-"
              }</td>
            </tr>

            <tr>
              <td><b>Delivery</b></td>
              <td>${
                tender.deliveryWindow?.from && tender.deliveryWindow?.to
                  ? `${moment(tender.deliveryWindow.from)
                      .tz(timezone)
                      .format("DD MMM YYYY")} → ${moment(
                      tender.deliveryWindow.to,
                    )
                      .tz(timezone)
                      .format("DD MMM YYYY")}`
                  : "-"
              }</td>
            </tr>

            <tr>
              <td><b>Your Price</b></td>
              <td>₹${Number(quotation.price).toLocaleString("en-IN")} / MT</td>
            </tr>
          </table>

          <p style="margin-top:12px;color:#6b7280">
            If you do not respond, RR user cannot proceed to payment & finalization.
          </p>
        </div>
      `,
    });

    return {
      sent: true,
      reason: null,
    };
  } catch (e) {
    console.error("[autoSelection] email failed:", e?.message);

    return {
      sent: false,
      reason: e?.message || "email_failed",
    };
  }
};

export const autoRequestFirstSelectionConfirmation = async (tenderId) => {
  if (!mongoose.isValidObjectId(tenderId)) {
    return {
      ok: false,
      skipped: true,
      reason: "Invalid tender id",
    };
  }

  const tender = await Tender.findById(tenderId).lean();

  if (!tender) {
    return {
      ok: false,
      skipped: true,
      reason: "Tender not found",
    };
  }

  const tenderStatus = String(tender.status || "").toLowerCase();

  if (["draft", "finalized", "closed", "cancelled"].includes(tenderStatus)) {
    return {
      ok: false,
      skipped: true,
      reason: "Tender already completed/cancelled/draft",
    };
  }

  if (tender.autoSelectionRequestedAt) {
    return {
      ok: false,
      skipped: true,
      reason: "Auto selection already requested",
    };
  }

  const selectionStatus = String(tender?.selection?.status || "none").toLowerCase();

  if (["pending", "confirmed"].includes(selectionStatus)) {
    return {
      ok: false,
      skipped: true,
      reason: "Selection already pending/confirmed",
    };
  }

  // Important:
  // If transporter rejected, or RR reopened, auto request should not run again.
  // Manual button will be used for next user.
  if (hasAnySelectionHistory(tender)) {
    return {
      ok: false,
      skipped: true,
      reason: "Selection history already exists",
    };
  }

  const now = new Date();

  if (tender.biddingEnd && now < new Date(tender.biddingEnd)) {
    return {
      ok: false,
      skipped: true,
      reason: "Normal bidding not completed",
    };
  }

  const postBidStatus = String(tender?.postBid?.status || "inactive").toLowerCase();

  if (
    postBidStatus === "active" &&
    tender?.postBid?.endsAt &&
    now < new Date(tender.postBid.endsAt)
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "Post-bid still active",
    };
  }

  const winner = await getAutoWinnerQuotation(tender);

  if (!winner?._id || !winner?.transportUser) {
    return {
      ok: false,
      skipped: true,
      reason: "No eligible quotation found",
    };
  }

  const requestAt = new Date();

  const updatedTender = await Tender.findOneAndUpdate(
    {
      _id: tender._id,

      autoSelectionRequestedAt: null,

      $or: [
        { "selection.status": { $exists: false } },
        { "selection.status": { $in: [null, "", "none", "rejected"] } },
        { selection: null },
      ],
    },
    {
      $set: {
        selection: {
          status: "pending",
          quotation: winner._id,
          transporter: winner.transportUser,
          requestedAt: requestAt,
          respondedAt: null,
          response: null,
          rejectReason: "",
        },

        autoSelectionRequestedAt: requestAt,
        autoSelectionRequestedQuotation: winner._id,
        autoSelectionRequestedTransporter: winner.transportUser,
      },

      $push: {
        selectionHistory: {
          action: "request",
          status: "pending",
          quotation: winner._id,
          transporter: winner.transportUser,
          reason: "Auto request after bidding/post-bid completion",
          byRole: "system",
          at: requestAt,
        },
      },
    },
    { new: true },
  ).lean();

  if (!updatedTender) {
    return {
      ok: false,
      skipped: true,
      reason: "Already processed by another cron/request",
    };
  }

  const email = await sendSelectionRequestEmail({
    tender: updatedTender,
    quotation: winner,
  });

  return {
    ok: true,
    skipped: false,
    tenderId: String(tender._id),
    quotationId: String(winner._id),
    transporterId: String(winner.transportUser),
    email,
  };
};