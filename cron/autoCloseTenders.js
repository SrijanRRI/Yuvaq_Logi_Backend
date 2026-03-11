import cron from 'node-cron';
import Tender from '../models/tenderSchema.js';

cron.schedule("0 0 * * *", async () => {
  console.log("[Cron] Auto-close check started...");

  // Get current time in local timezone
  const now = new Date();

  // Get today's local date (as Y-M-D), add 1 day → tomorrow local midnight
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  try {
    const result = await Tender.updateMany(
      {
        closeDate: { $lt: localMidnight },
        status: { $ne: ["open", "quoted"] }
      },
      { $set: { status: "closed" } }
    );

    console.log(`[Cron] Auto-closed ${result.modifiedCount} tenders.`);
  } catch (error) {
    console.error("[Cron] Error during auto-close:", error.message);
  }
});
