// import mongoose from "mongoose";
// import Tender from "../models/tenderSchema.js";

// export default function autoEndPostBid() {
//   setInterval(async () => {
//     try {
//       if (mongoose.connection.readyState !== 1) return;

//       const now = new Date();

//       const res = await Tender.updateMany(
//         {
//           "postBid.status": "active",
//           "postBid.endsAt": { $lte: now },
//         },
//         {
//           $set: {
//             "postBid.status": "ended",
//             "postBid.endedAt": now,
//             "postBid.endedReason": "time_expired",
//           },
//         },
//       );

//       if (res?.modifiedCount) {
//         console.log(
//           `[autoEndPostBid] ended postBid for ${res.modifiedCount} tenders`,
//         );
//       }
//     } catch (e) {
//       console.error("[autoEndPostBid] error:", e.message);
//     }
//   }, 30 * 1000); // every 30s (safe for 10-min window)
// }

import mongoose from "mongoose";
import Tender from "../models/tenderSchema.js";
import { autoRequestFirstSelectionConfirmation } from "../services/autoSelectionRequest.service.js";

const INTERVAL_MS = 30 * 1000;

const NO_POST_BID_GRACE_MS = Number(
  process.env.AUTO_SELECTION_NO_POSTBID_GRACE_MS || 90 * 1000,
);

const selectableCondition = {
  $or: [
    { "selection.status": { $exists: false } },
    { "selection.status": { $in: [null, "", "none", "rejected"] } },
    { selection: null },
  ],
};

const safeAutoRequest = async (tenderId, source) => {
  try {
    const out = await autoRequestFirstSelectionConfirmation(tenderId);

    if (out?.ok) {
      console.log(
        `[autoSelection:${source}] requested confirmation tender=${out.tenderId} quotation=${out.quotationId} transporter=${out.transporterId}`,
      );
    } else if (out?.reason) {
      console.log(
        `[autoSelection:${source}] skipped tender=${tenderId} reason=${out.reason}`,
      );
    }

    return out;
  } catch (e) {
    console.error(
      `[autoSelection:${source}] failed tender=${tenderId}:`,
      e?.message,
    );

    return {
      ok: false,
      skipped: false,
      reason: e?.message || "auto_selection_failed",
    };
  }
};

export default function autoEndPostBid() {
  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;

      const now = new Date();

      // 1) End expired active post-bids and immediately request PB1/effective L1.
      const expiredPostBidTenders = await Tender.find({
        status: { $in: ["open", "quoted"] },
        "postBid.status": "active",
        "postBid.endsAt": { $lte: now },
      })
        .select("_id")
        .limit(100)
        .lean();

      let endedCount = 0;

      for (const t of expiredPostBidTenders) {
        const updated = await Tender.findOneAndUpdate(
          {
            _id: t._id,
            "postBid.status": "active",
            "postBid.endsAt": { $lte: now },
          },
          {
            $set: {
              "postBid.status": "ended",
              "postBid.endedAt": now,
              "postBid.endedReason": "time_expired",
            },
          },
          { new: true },
        )
          .select("_id")
          .lean();

        if (!updated?._id) continue;

        endedCount += 1;

        await safeAutoRequest(updated._id, "post_bid_time_expired");
      }

      if (endedCount) {
        console.log(`[autoEndPostBid] ended postBid for ${endedCount} tenders`);
      }

      // 2) Recovery: post-bid already ended but auto request was missed.
      const endedButNotRequested = await Tender.find({
        status: { $in: ["open", "quoted"] },
        "postBid.status": "ended",
        autoSelectionRequestedAt: null,
        ...selectableCondition,
      })
        .select("_id")
        .limit(100)
        .lean();

      for (const t of endedButNotRequested) {
        await safeAutoRequest(t._id, "post_bid_recovery");
      }

      // 3) Fallback: no post-bid exists/started, so request normal L1.
      // Small grace avoids racing with autoStartPostBid.
      const noPostBidCutoff = new Date(Date.now() - NO_POST_BID_GRACE_MS);

      const normalEndedNoPostBid = await Tender.find({
        status: { $in: ["open", "quoted"] },
        biddingEnd: { $lte: noPostBidCutoff },
        autoSelectionRequestedAt: null,

        $and: [
          {
            $or: [
              { "postBid.enabled": { $ne: true } },
              { "postBid.status": { $exists: false } },
              { "postBid.status": { $in: [null, "", "inactive"] } },
            ],
          },
          selectableCondition,
        ],
      })
        .select("_id")
        .limit(100)
        .lean();

      for (const t of normalEndedNoPostBid) {
        await safeAutoRequest(t._id, "normal_l1_no_post_bid");
      }
    } catch (e) {
      console.error("[autoEndPostBid] error:", e.message);
    }
  }, INTERVAL_MS);
}
