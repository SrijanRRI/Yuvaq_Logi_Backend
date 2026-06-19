import mongoose from "mongoose";
import moment from "moment-timezone";

import Tender from "../models/tenderSchema.js";
import Quotation from "../models/quotationSchema.js";
import User from "../models/userSchema.js";
import { sendMail } from "../utils/sendMail.js";

const POST_BID_MINUTES = 5;
const CHECK_INTERVAL_MS = 15 * 1000;
const timezone = "Asia/Kolkata";

const AUTO_POST_BID_MIN_PERCENT = 0.8; // L1 - 20% (below L1) 
const AUTO_POST_BID_MAX_PERCENT = 0.985; // L1 - 1.5% (below L1)

const autoPostBidEligibleTenderFilter = {
  status: { $in: ["open", "quoted", "closed"] },

  $and: [
    {
      $or: [
        { selectedQuotation: { $exists: false } },
        { selectedQuotation: null },
      ],
    },
    {
      $or: [
        { "selection.status": { $exists: false } },
        { "selection.status": "none" },
        { "selection.status": { $nin: ["pending", "confirmed"] } },
      ],
    },
    {
      $or: [
        { "postBid.enabled": { $ne: true } },
        { "postBid.status": "inactive" },
        { "postBid.status": { $exists: false } },
        { "postBid.status": null },
        { "postBid.status": "" },
      ],
    },
  ],
};

const normalPhaseFilter = {
  $or: [
    { phase: "normal" },
    { phase: { $exists: false } },
    { phase: null },
    { phase: "" },
  ],
};

const calculateAutoPostBidRange = (l1Price) => {
  const price = Number(l1Price);

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const rangeMin = Math.max(1, Math.round(price * AUTO_POST_BID_MIN_PERCENT));
  const rangeMax = Math.max(
    rangeMin,
    Math.round(price * AUTO_POST_BID_MAX_PERCENT),
  );

  return { rangeMin, rangeMax };
};

const getBestNormalQuotesPerTransporter = async (tenderId) => {
  const quotations = await Quotation.find({
    tender: tenderId,
    ...normalPhaseFilter,
  })
    .sort({ price: 1, createdAt: 1 })
    .lean();

  const bestByTransporter = new Map();

  for (const q of quotations) {
    const transporterId = String(q.transportUser || "");
    if (!transporterId) continue;

    const existing = bestByTransporter.get(transporterId);

    if (!existing) {
      bestByTransporter.set(transporterId, q);
      continue;
    }

    const oldPrice = Number(existing.price);
    const newPrice = Number(q.price);

    if (newPrice < oldPrice) {
      bestByTransporter.set(transporterId, q);
    } else if (newPrice === oldPrice) {
      const oldTime = existing.createdAt
        ? new Date(existing.createdAt).getTime()
        : 0;

      const newTime = q.createdAt ? new Date(q.createdAt).getTime() : 0;

      if (newTime < oldTime) {
        bestByTransporter.set(transporterId, q);
      }
    }
  }

  return Array.from(bestByTransporter.values()).sort((a, b) => {
    const pa = Number(a.price ?? Infinity);
    const pb = Number(b.price ?? Infinity);

    if (pa !== pb) return pa - pb;

    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    return ta - tb;
  });
};

async function notifyAutoPostBidTransporters({
  tender,
  users,
  rangeMin,
  rangeMax,
  endsAt,
}) {
  const endStr = moment(endsAt).tz(timezone).format("DD MMM YYYY, hh:mm A");

  const rangeStr = `₹${Number(rangeMin).toLocaleString("en-IN")} - ₹${Number(
    rangeMax,
  ).toLocaleString("en-IN")}`;

  for (const u of users) {
    if (!u.email) continue;

    try {
      await sendMail({
        to: u.email,
        subject: "⏱️ Auto Post-Bid Negotiation Started — LogiQ",
        html: `
          <div style="font-family:Arial;line-height:1.5">
            <h2 style="margin:0 0 10px;color:#059669">LogiQ</h2>

            <p>Hello <b>${u.name || "Transporter"}</b>,</p>

            <p>
              The normal bidding window has ended and <b>post-bid negotiation</b>
              has started automatically.
            </p>

            <p><b>Project:</b> ${tender.projectName || "-"}</p>
            <p><b>Allowed price range:</b> ${rangeStr}</p>
            <p><b>Window ends at:</b> ${endStr} (IST)</p>

            <p>
              Please open your transporter dashboard and submit your improved quote before the timer ends.
            </p>
          </div>
        `,
      });
    } catch (e) {
      console.error("[autoStartPostBid] email failed:", u.email, e?.message);
    }
  }
}

async function autoStartPostBidForTender(tender) {
  const tenderId = tender._id;

  const bestNormalQuotes = await getBestNormalQuotesPerTransporter(tenderId);

  if (!bestNormalQuotes.length) {
    console.log(`[autoStartPostBid] skipped ${tenderId}: no normal quotations`);
    return;
  }

  const l1Quote = bestNormalQuotes[0];
  const l1Price = Number(l1Quote.price);

  const range = calculateAutoPostBidRange(l1Price);

  if (!range) {
    console.log(`[autoStartPostBid] skipped ${tenderId}: invalid L1 price`);
    return;
  }

  // const eligibleTransporters = [
  //   ...new Set(
  //     bestNormalQuotes
  //       .map((q) => q.transportUser)
  //       .filter(Boolean)
  //       .map(String),
  //   ),
  // ];

  // ✅ Eligible = TOP 5 participating transporters only
  const top5NormalQuotes = bestNormalQuotes.slice(0, 5);

  const eligibleTransporters = [
    ...new Set(
      top5NormalQuotes
        .map((q) => q.transportUser)
        .filter(Boolean)
        .map(String),
    ),
  ];

  if (!eligibleTransporters.length) {
    console.log(
      `[autoStartPostBid] skipped ${tenderId}: no eligible transporters`,
    );
    return;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + POST_BID_MINUTES * 60 * 1000);

  const updatedTender = await Tender.findOneAndUpdate(
    {
      _id: tenderId,
      ...autoPostBidEligibleTenderFilter,
    },
    {
      $set: {
        postBid: {
          enabled: true,
          status: "active",

          rangeMin: range.rangeMin,
          rangeMax: range.rangeMax,

          startedAt: now,
          endsAt,
          durationMinutes: POST_BID_MINUTES,

          eligibleTransporters,
          notifiedAt: now,

          autoStarted: true,
          baseL1Price: l1Price,
          baseQuotation: l1Quote._id,
        },
      },
    },
    { new: true },
  );

  if (!updatedTender) {
    console.log(
      `[autoStartPostBid] skipped ${tenderId}: already active/selected/finalized`,
    );
    return;
  }

  const users = await User.find({ _id: { $in: eligibleTransporters } })
    .select("name email")
    .lean();

  await notifyAutoPostBidTransporters({
    tender: updatedTender,
    users,
    rangeMin: range.rangeMin,
    rangeMax: range.rangeMax,
    endsAt,
  });

  // console.log(
  //   `[autoStartPostBid] started ${tenderId}. L1=${l1Price}, range=${range.rangeMin}-${range.rangeMax}, eligible=${eligibleTransporters.length}`,
  // );

  console.log(
    `[autoStartPostBid] started ${tenderId}. L1=${l1Price}, range=${range.rangeMin}-${range.rangeMax}, top5Eligible=${eligibleTransporters.length}`,
  );
}

async function runAutoStartPostBidTick() {
  if (mongoose.connection.readyState !== 1) {
    console.log("[autoStartPostBid] DB not connected yet");
    return;
  }

  const now = new Date();

  const dueTenders = await Tender.find({
    status: { $in: ["open", "quoted", "closed"] },
    biddingEnd: { $lte: now },

    $and: [
      {
        $or: [
          { selectedQuotation: { $exists: false } },
          { selectedQuotation: null },
        ],
      },
      {
        $or: [
          { "selection.status": { $exists: false } },
          { "selection.status": "none" },
          { "selection.status": { $nin: ["pending", "confirmed"] } },
        ],
      },
      {
        $or: [
          { "postBid.enabled": { $ne: true } },
          { "postBid.status": "inactive" },
          { "postBid.status": { $exists: false } },
          { "postBid.status": null },
          { "postBid.status": "" },
        ],
      },
    ],
  })
    .sort({ biddingEnd: 1 })
    .limit(20)
    .lean();

  if (dueTenders.length) {
    console.log(`[autoStartPostBid] Found ${dueTenders.length} due tender(s).`);
  }

  for (const tender of dueTenders) {
    await autoStartPostBidForTender(tender);
  }
}

// export function stays at bottom
let autoStartPostBidStarted = false;

export default function autoStartPostBid() {
  if (autoStartPostBidStarted) {
    console.log("[autoStartPostBid] Already running.");
    return;
  }

  autoStartPostBidStarted = true;

  console.log("[autoStartPostBid] Started.");

  setTimeout(() => {
    runAutoStartPostBidTick().catch((e) => {
      console.error("[autoStartPostBid] First run failed:", e.message);
    });
  }, 5000);

  setInterval(async () => {
    try {
      await runAutoStartPostBidTick();
    } catch (e) {
      console.error("[autoStartPostBid] Failed:", e.message);
    }
  }, CHECK_INTERVAL_MS);
}
