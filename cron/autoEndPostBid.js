import mongoose from "mongoose";
import Tender from "../models/tenderSchema.js";

export default function autoEndPostBid() {
  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;

      const now = new Date();

      const res = await Tender.updateMany(
        {
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
      );

      if (res?.modifiedCount) {
        console.log(
          `[autoEndPostBid] ended postBid for ${res.modifiedCount} tenders`,
        );
      }
    } catch (e) {
      console.error("[autoEndPostBid] error:", e.message);
    }
  }, 30 * 1000); // every 30s (safe for 10-min window)
}
