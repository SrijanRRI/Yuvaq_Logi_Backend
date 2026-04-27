import cron from "node-cron";
import Tender from "../models/tenderSchema.js";

cron.schedule("0 0 * * *", async () => {
  console.log("[Cron] Auto-close check started...");

  const now = new Date();
  const localMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  try {
    const result = await Tender.updateMany(
      {
        closeDate: { $lt: localMidnight },

        // ✅ only close active tender records
        status: { $in: ["open", "quoted"] },

        // ✅ do not close while post-bid is active
        "postBid.status": { $ne: "active" },
      },
      {
        $set: { status: "closed" },
      },
    );

    console.log(`[Cron] Auto-closed ${result.modifiedCount} tenders.`);
  } catch (error) {
    console.error("[Cron] Error during auto-close:", error.message);
  }
});