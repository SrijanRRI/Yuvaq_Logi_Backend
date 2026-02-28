import mongoose from "mongoose";
import Tender from "../models/tenderSchema.js";
import { buildTenderPayloadFromBody } from "../services/tenderPayload.service.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export const createTenderDraft = async (req, res) => {
  try {
    const now = new Date();

    // If user already has an active draft, return it (don’t create duplicates)
    const existing = await Tender.findOne({
      createdBy: req.user.id,
      status: "draft",
      draftCancelledAt: null,
      draftSubmitAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "You already have an active draft. Continue editing it.",
        data: existing,
      });
    }

    const payload = buildTenderPayloadFromBody(req.body, req.user.id);

    const submitAt = new Date(Date.now() + 3 * 60 * 1000);

    const draft = new Tender({
      ...payload,
      status: "draft",
      draftSubmitAt: submitAt,
      lastEditedAt: now,

      // safety
      draftCancelledAt: null,
      draftFinalizedAt: null,
      draftProcessingAt: null,
      publishedAt: null,
    });

    await draft.save();

    return res.status(201).json({
      success: true,
      data: draft,
    });
  } catch (error) {
    console.error("createTenderDraft failed:", error);
    const status = error?.status || 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export const updateTenderDraft = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) throw httpError(400, "Invalid draft id");

    const now = new Date();

    const payload = buildTenderPayloadFromBody(req.body, req.user.id);

    const updated = await Tender.findOneAndUpdate(
      {
        _id: id,
        createdBy: req.user.id,
        status: "draft",
        draftCancelledAt: null,
        draftProcessingAt: null,
        draftSubmitAt: { $gt: now }, // must still be within 3-min window
      },
      {
        $set: {
          ...payload,
          lastEditedAt: now,
        },
      },
      { new: true },
    );

    if (!updated) {
      throw httpError(409, "Draft not editable (expired, cancelled, or publishing).");
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("updateTenderDraft failed:", error);
    const status = error?.status || 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export const getMyActiveDraftTender = async (req, res) => {
  try {
    const now = new Date();

    const draft = await Tender.findOne({
      createdBy: req.user.id,
      status: "draft",
      draftCancelledAt: null,
      draftSubmitAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: draft || null,
      remainingMs: draft?.draftSubmitAt ? Math.max(0, new Date(draft.draftSubmitAt).getTime() - Date.now()) : 0,
    });
  } catch (error) {
    console.error("getMyActiveDraftTender failed:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const cancelTenderDraft = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) throw httpError(400, "Invalid draft id");

    const now = new Date();

    const cancelled = await Tender.findOneAndUpdate(
      {
        _id: id,
        createdBy: req.user.id,
        status: "draft",
        draftCancelledAt: null,
        draftProcessingAt: null, // cannot cancel once publishing lock acquired
      },
      {
        $set: {
          status: "cancelled",
          draftCancelledAt: now,
          draftSubmitAt: null,
        },
      },
      { new: true },
    );

    if (!cancelled) throw httpError(404, "Draft not found or cannot be cancelled");

    return res.json({ success: true, data: cancelled });
  } catch (error) {
    console.error("cancelTenderDraft failed:", error);
    const status = error?.status || 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};