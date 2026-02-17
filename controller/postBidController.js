import Tender from "../models/tenderSchema.js";
import User from "../models/userSchema.js";
import mongoose from "mongoose";
import moment from "moment-timezone";
import { sendMail } from "../utils/sendMail.js";
import { getBestQuotesPerTransporter } from "../utils/ranking.js";

import Quotation from "../models/quotationSchema.js";
import { s3, BUCKET_NAME } from "../utils/minioClient.js";

const POST_BID_MINUTES = 10;
const timezone = "Asia/Kolkata";

function withinPostBidStartWindow(tender, now) {
  const bidEnd = new Date(tender.biddingEnd);
  const hardEnd = new Date(bidEnd.getTime() + POST_BID_MINUTES * 60 * 1000);
  return now >= bidEnd && now <= hardEnd;
}

export const startPostBidNegotiation = async (req, res) => {
  try {
    const tenderId = req.params.id;
    const { rangeMin, rangeMax } = req.body;

    if (!mongoose.isValidObjectId(tenderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tender id" });
    }

    const min = Number(rangeMin);
    const max = Number(rangeMax);
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < 0 ||
      max < 0 ||
      min > max
    ) {
      return res.status(400).json({
        success: false,
        message:
          "rangeMin/rangeMax must be valid numbers and rangeMin <= rangeMax",
      });
    }

    const tender = await Tender.findById(tenderId);
    if (!tender)
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });

    // only creator
    if (String(tender.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // can't start if already finalized/selected
    if (tender.status === "finalized" || tender.selectedQuotation) {
      return res.status(409).json({
        success: false,
        message: "Tender already finalized/selected.",
      });
    }

    const now = new Date();
    if (!withinPostBidStartWindow(tender, now)) {
      const bidEnd = new Date(tender.biddingEnd);
      return res.status(409).json({
        success: false,
        message:
          "Post-bid can be started only within 10 minutes after bidding end.",
        data: {
          biddingEnd: bidEnd,
          postBidHardEnd: new Date(
            bidEnd.getTime() + POST_BID_MINUTES * 60 * 1000,
          ),
          now,
        },
      });
    }

    // block double-start
    if (tender.postBid?.status === "active") {
      return res.status(200).json({
        success: true,
        message: "Post-bid already active (idempotent).",
        postBid: tender.postBid,
      });
    }

    const bidEnd = new Date(tender.biddingEnd);
    const endsAt = new Date(bidEnd.getTime() + POST_BID_MINUTES * 60 * 1000);

    // freeze eligible top3 based on NORMAL quotes only
    // const bestNormal = await getBestQuotesPerTransporter({ tenderId: tender._id, phase: "normal" });
    // const top3 = bestNormal.slice(0, 3);

    // const eligibleIds = top3.map((q) => q.transportUser).filter(Boolean);

    // ✅ Eligible = ALL participating transporters (unique) based on NORMAL quotes
    const bestNormal = await getBestQuotesPerTransporter({
      tenderId: tender._id,
      phase: "normal",
    });

    const eligibleIds = bestNormal.map((q) => q.transportUser).filter(Boolean);

    if (!eligibleIds.length) {
      return res.status(409).json({
        success: false,
        message: "No participating transporters found for post-bid.",
      });
    }

    tender.postBid = {
      enabled: true,
      status: "active",
      rangeMin: min,
      rangeMax: max,
      startedAt: now,
      endsAt,
      eligibleTransporters: eligibleIds,
      notifiedAt: now,
    };

    await tender.save();

    // notify eligible transporters
    const users = await User.find({ _id: { $in: eligibleIds } })
      .select("name email")
      .lean();

    const endStr = moment(endsAt).tz(timezone).format("DD MMM YYYY, hh:mm A");
    const rangeStr = `₹${min.toLocaleString("en-IN")} - ₹${max.toLocaleString("en-IN")}`;

    for (const u of users) {
      if (!u.email) continue;
      try {
        await sendMail({
          to: u.email,
          subject: "⏱️ Post-Bid Negotiation Started (10 mins) — LogiQ",
          html: `
            <div style="font-family:Arial;line-height:1.5">
              <h2 style="margin:0 0 10px;color:#059669">LogiQ</h2>
              <p>Hello <b>${u.name || "Transporter"}</b>,</p>
              <p><b>Post-bid negotiation</b> is now active for a tender you participated in.</p>
              <p><b>Allowed price range:</b> ${rangeStr}</p>
              <p><b>Window ends at:</b> ${endStr} (IST)</p>
              <p>Please open your dashboard and submit your post-bid quote before time expires.</p>
            </div>
          `,
        });
      } catch (e) {
        // non-blocking
        console.error("postBid notify email failed:", u.email, e?.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Post-bid started and notifications sent.",
      postBid: tender.postBid,
      eligibleCount: eligibleIds.length,
    });
  } catch (err) {
    console.error("startPostBidNegotiation error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const submitPostBidQuotation = async (req, res) => {
  try {
    const tenderId = req.params.tenderId;
    const userId = req.user.id;

    if (!mongoose.isValidObjectId(tenderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tender id" });
    }

    const { price, vehicleNumber } = req.body;
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ success: false, message: "Invalid price" });
    }

    if (!vehicleNumber || !String(vehicleNumber).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Vehicle number is required" });
    }

    const tender = await Tender.findById(tenderId).lean();
    if (!tender)
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });

    const pb = tender.postBid;
    if (!pb?.enabled || pb.status !== "active" || !pb.endsAt) {
      return res.status(403).json({
        success: false,
        message: "Post-bid is not active for this tender",
      });
    }

    const now = new Date();
    if (now > new Date(pb.endsAt)) {
      return res
        .status(403)
        .json({ success: false, message: "Post-bid window expired" });
    }

    const eligible = (pb.eligibleTransporters || [])
      .map(String)
      .includes(String(userId));
    if (!eligible) {
      return res.status(403).json({
        success: false,
        message: "You are not eligible for post-bid on this tender",
      });
    }

    // enforce RR user's range
    const min = Number(pb.rangeMin);
    const max = Number(pb.rangeMax);
    if (Number.isFinite(min) && numericPrice < min) {
      return res
        .status(400)
        .json({ success: false, message: `Price must be >= ${min}` });
    }
    if (Number.isFinite(max) && numericPrice > max) {
      return res
        .status(400)
        .json({ success: false, message: `Price must be <= ${max}` });
    }

    // allow only 1 post-bid submission total (no updates)
    const existing = await Quotation.findOne({
      tender: tenderId,
      transportUser: userId,
      phase: "post_bid",
    }).select("_id");

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          "You have already submitted your post-bid quotation. Only one submission is allowed.",
      });
    }

    // upload optional file
    let uploadedFiles = [];
    if (req.file) {
      const file = req.file;
      const filename = Date.now() + "-" + file.originalname;

      const params = {
        Bucket: BUCKET_NAME,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      const result = await s3.upload(params).promise();
      uploadedFiles.push({
        url: result.Location,
        originalName: file.originalname,
        mimetype: file.mimetype,
        uploadedAt: new Date(),
      });
    }

    // ✅ Create post-bid quotation
    const doc = await Quotation.create({
      tender: tenderId,
      transportUser: userId,
      price: numericPrice,
      vehicleNumber,
      files: uploadedFiles,
      phase: "post_bid",
    });

    // IMPORTANT: do NOT push to tender.quotations if you treat that array as normal-only.
    // If you currently rely on tender.quotations for anything critical, then push it.
    // Safer approach: keep pushing for consistency:
    await Tender.updateOne(
      { _id: tenderId },
      { $push: { quotations: doc._id } },
    );

    return res.status(201).json({
      success: true,
      message: existing
        ? "Post-bid quotation updated"
        : "Post-bid quotation submitted",
      quotation: doc,
      endsAt: pb.endsAt,
    });
  } catch (err) {
    console.error("submitPostBidQuotation error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getActivePostBidForTransporter = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const tenders = await Tender.find({
      "postBid.enabled": true,
      "postBid.status": "active",
      "postBid.endsAt": { $gt: now },
      "postBid.eligibleTransporters": userId,
    })
      .select(
        "dispatchLocation address pincode biddingEnd postBid deliveryWindow materials projectName projectCode",
      )
      .sort({ "postBid.endsAt": 1 })
      .lean();

    const data = tenders.map((t) => ({
      tenderId: t._id,
      projectName: t.projectName,
      projectCode: t.projectCode,
      dispatchLocation: t.dispatchLocation,
      address: t.address,
      pincode: t.pincode,
      endsAt: t.postBid?.endsAt,
      remainingMs: new Date(t.postBid?.endsAt).getTime() - now.getTime(),
      rangeMin: t.postBid?.rangeMin,
      rangeMax: t.postBid?.rangeMax,
    }));

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
