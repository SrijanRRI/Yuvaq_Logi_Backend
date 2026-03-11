import mongoose from "mongoose";
import Tender from "../models/tenderSchema.js";
import { notifyTenderTransportersInternal } from "../services/tenderNotify.service.js";

async function markShipmentPlannedIfPossible(tender) {
  try {
    const shipId = tender?.shipmentPlan;
    if (!shipId) return;

    // If ShipmentPlanning model is registered, update status
    const ShipmentPlanning = mongoose.models.ShipmentPlanning;
    if (!ShipmentPlanning) return;

    await ShipmentPlanning.updateOne(
      { _id: shipId },
      { $set: { status: "planned" } },
    );
  } catch (e) {
    // non-blocking
    console.warn("[finalizeDraftTenders] shipment plan update skipped:", e?.message);
  }
}

async function finalizeOneDueDraft(now) {
  // Acquire lock (prevents double finalize in multi-instance deployments)
  const draft = await Tender.findOneAndUpdate(
    {
      status: "draft",
      draftCancelledAt: null,
      draftProcessingAt: null,
      draftSubmitAt: { $lte: now },
    },
    { $set: { draftProcessingAt: now } },
    { new: true },
  );

  if (!draft) return null;

  try {
    // Publish
    draft.status = "open";
    draft.publishedAt = now;
    draft.draftFinalizedAt = now;

    // Clear draft timers (optional but keeps doc clean)
    draft.draftSubmitAt = null;

    await draft.save();

    // Mark shipment planned (best effort)
    await markShipmentPlannedIfPossible(draft);

    // Send WhatsApp notifications after publish
    try {
      await notifyTenderTransportersInternal(String(draft._id));
      console.log(`[finalizeDraftTenders] notified transporters for tender ${draft._id}`);
    } catch (e) {
      console.error(`[finalizeDraftTenders] notify failed for ${draft._id}:`, e.message);
    }

    // release lock
    await Tender.updateOne({ _id: draft._id }, { $set: { draftProcessingAt: null } });

    console.log(`[finalizeDraftTenders] published draft tender ${draft._id}`);
    return draft;
  } catch (e) {
    console.error("[finalizeDraftTenders] publish failed:", e.message);

    // release lock so it can retry
    await Tender.updateOne({ _id: draft._id }, { $set: { draftProcessingAt: null } });
    return null;
  }
}

export default function startFinalizeDraftTenders() {
  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;

      const now = new Date();

      // process a few per tick (avoid long blocking)
      for (let i = 0; i < 10; i++) {
        const done = await finalizeOneDueDraft(now);
        if (!done) break;
      }
    } catch (e) {
      console.error("[finalizeDraftTenders] tick error:", e.message);
    }
  }, 5000);
}