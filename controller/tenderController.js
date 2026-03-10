import Tender from "../models/tenderSchema.js";
import Quotation from "../models/quotationSchema.js";
import { generateSignedUrl } from "../utils/minioClient.js";
import mongoose from "mongoose";
import User from "../models/userSchema.js"; // Replace with your actual user model path
import { sendMail } from "../utils/sendMail.js"; // You must have this utility created
import userModel from "../models/userSchema.js";
//  Create Tender with bidding window + delivery window
import moment from "moment-timezone";
import { sendWhatsAppTemplate } from "../utils/sendWhatsapp.js";
import TenderPayment from "../models/TenderPayment.js";
import { notifyTenderTransportersInternal } from "../services/tenderNotify.service.js";
import { buildTenderPayloadFromBody } from "../services/tenderPayload.service.js";

function pushSelectionHistory(tender, entry) {
  tender.selectionHistory = tender.selectionHistory || [];
  tender.selectionHistory.push({
    quotation: entry.quotation || null,
    transporter: entry.transporter || null,
    action: entry.action, // required
    status: entry.status, // required
    reason: entry.reason || "",
    byRole: entry.byRole || "system",
    at: entry.at || new Date(),
  });
}

// export const createTender = async (req, res) => {
//   try {
//     const {
//       shipmentPlanId,
//       pickup,
//       drop,
//       vehicleRequirements,
//       transporters,
//       remarks,
//       closeDate,
//       deliveryWindow,
//       biddingStart,
//       biddingEnd, // (Soft End for now)
//       biddingHardEnd, // ✅ NEW (optional for now)
//       totalWeight,
//       totalQuantity,
//       projectName,
//       projectCode,
//       purchaseOrder,
//       projectRemark,
//       priceDifference, // <-- accept from frontend
//       maxBidAmount,
//       maxBidUnit,
//       minBidAmount,
//     } = req.body;

//     // basic validations
//     if (!projectName || !projectCode || !purchaseOrder) {
//       return res.status(400).json({
//         success: false,
//         message: "Project name, code and PO are required",
//       });
//     }
//     if (!biddingStart || !biddingEnd) {
//       return res.status(400).json({
//         success: false,
//         message: "Bidding start and end time are required",
//       });
//     }
//     if (!deliveryWindow?.from || !deliveryWindow?.to) {
//       return res.status(400).json({
//         success: false,
//         message: "Delivery window (from and to dates) is required",
//       });
//     }

//     if (!pickup?.pincode || !pickup?.address) {
//       return res.status(400).json({
//         success: false,
//         message: "Pickup pincode and address are required",
//       });
//     }

//     if (!drop?.pincode || !drop?.address) {
//       return res.status(400).json({
//         success: false,
//         message: "Drop pincode and address are required",
//       });
//     }

//     if (
//       !vehicleRequirements ||
//       !Array.isArray(vehicleRequirements) ||
//       vehicleRequirements.length === 0
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "At least one vehicle requirement is required",
//       });
//     }

//     // optional shipmentPlanId
//     let shipmentPlanRef = null;
//     if (shipmentPlanId) {
//       if (!mongoose.isValidObjectId(shipmentPlanId)) {
//         return res
//           .status(400)
//           .json({ success: false, message: "Invalid shipmentPlanId" });
//       }
//       shipmentPlanRef = shipmentPlanId;
//     }

//     // validate priceDifference if provided
//     let priceDifferenceValue;
//     if (
//       priceDifference !== undefined &&
//       priceDifference !== null &&
//       priceDifference !== ""
//     ) {
//       const n = Number(priceDifference);
//       if (!Number.isFinite(n)) {
//         return res.status(400).json({
//           success: false,
//           message: "priceDifference must be a valid number",
//         });
//       }

//       priceDifferenceValue = n;
//     }

//     // time conversions (IST → UTC)
//     const timezone = "Asia/Kolkata";
//     const utcBiddingStart = moment.tz(biddingStart, timezone).utc().toDate();
//     const utcBiddingEnd = moment.tz(biddingEnd, timezone).utc().toDate();

//     const utcBiddingSoftEnd = utcBiddingEnd;

//     // ✅ if frontend doesn't send biddingHardEnd, hard = soft (no extension; same as today)
//     const utcBiddingHardEnd = biddingHardEnd
//       ? moment.tz(biddingHardEnd, timezone).utc().toDate()
//       : utcBiddingEnd;

//     // ✅ validate hard end >= soft end (only when provided)
//     if (utcBiddingHardEnd.getTime() < utcBiddingSoftEnd.getTime()) {
//       return res.status(400).json({
//         success: false,
//         message: "biddingHardEnd must be >= biddingEnd (soft end)",
//       });
//     }

//     const utcDeliveryFrom = moment
//       .tz(deliveryWindow.from, timezone)
//       .utc()
//       .toDate();
//     const utcDeliveryTo = moment.tz(deliveryWindow.to, timezone).utc().toDate();

//     let utcCloseDate = null;
//     if (closeDate) {
//       const [year, month, day] = closeDate.split("-").map(Number);
//       utcCloseDate = new Date(Date.UTC(year, month - 1, day));
//     }

//     // normalize vehicle requirements
//     const normalizedVehicles = vehicleRequirements.map((v) => ({
//       vehicleId: v.vehicleId,
//       category: String(v.category || "").trim(),
//       subCategory: String(v.subCategory || "").trim(),
//       quantity: Number(v.quantity || 1),
//     }));

//     // validate each vehicle row
//     for (const v of normalizedVehicles) {
//       if (!v.vehicleId || !mongoose.isValidObjectId(v.vehicleId)) {
//         return res.status(400).json({
//           success: false,
//           message: "Valid vehicleId is required for each vehicle requirement",
//         });
//       }

//       if (!v.category || !v.subCategory) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "Each vehicle requirement must include category and subCategory",
//         });
//       }
//       if (!Number.isFinite(v.quantity) || v.quantity < 1) {
//         return res.status(400).json({
//           success: false,
//           message: "Vehicle quantity must be a number >= 1",
//         });
//       }
//     }

//     // ✅ validate bid limits
//     const minAmt = Number(minBidAmount);
//     const maxAmt = Number(maxBidAmount);

//     if (!Number.isFinite(maxAmt) || maxAmt <= 0) {
//       return res.status(400).json({
//         success: false,
//         message: "maxBidAmount must be a valid number > 0",
//       });
//     }

//     if (!Number.isFinite(minAmt) || minAmt < 0) {
//       return res.status(400).json({
//         success: false,
//         message: "minBidAmount must be a valid number >= 0",
//       });
//     }

//     const allowedUnits = ["Per MT", "Per Tender"];
//     if (!maxBidUnit || !allowedUnits.includes(String(maxBidUnit))) {
//       return res.status(400).json({
//         success: false,
//         message: "maxBidUnit is required and must be Per MT or Per Tender",
//       });
//     }

//     if (minAmt > maxAmt) {
//       return res.status(400).json({
//         success: false,
//         message: "minBidAmount cannot be greater than maxBidAmount",
//       });
//     }

//     const tenderPayload = {
//       createdBy: req.user.id,
//       shipmentPlan: shipmentPlanRef || null,
//       pickup,
//       drop,
//       vehicleRequirements: normalizedVehicles,
//       transporters,
//       remarks: remarks || "",
//       closeDate: utcCloseDate,
//       biddingStart: utcBiddingStart,
//       biddingEnd: utcBiddingSoftEnd,

//       //  store soft/hard explicitly
//       biddingSoftEnd: utcBiddingSoftEnd,
//       biddingHardEnd: utcBiddingHardEnd,

//       deliveryWindow: { from: utcDeliveryFrom, to: utcDeliveryTo },
//       totalWeight,
//       totalQuantity,
//       projectName,
//       projectCode,
//       purchaseOrder,
//       projectRemark: projectRemark || "",
//       minBidAmount: minAmt,
//       maxBidAmount: maxAmt,
//       maxBidUnit: String(maxBidUnit),

//       status: "open",
//       publishedAt: new Date(),
//       draftSubmitAt: null,
//       draftCancelledAt: null,
//       draftFinalizedAt: null,
//       draftProcessingAt: null,
//       lastEditedAt: null,
//     };

//     // only set if provided so Mongoose default can apply otherwise
//     if (priceDifferenceValue !== undefined) {
//       tenderPayload.priceDifference = priceDifferenceValue;
//     }

//     const tender = new Tender(tenderPayload);
//     await tender.save();

//     res.status(201).json({ success: true, data: tender });
//   } catch (error) {
//     console.error("Tender creation failed:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

export const createTender = async (req, res) => {
  try {
    const payload = buildTenderPayloadFromBody(req.body, req.user.id);

    const tender = new Tender({
      ...payload,
      status: "open",
      publishedAt: new Date(),
      draftSubmitAt: null,
      draftCancelledAt: null,
      draftFinalizedAt: null,
      draftProcessingAt: null,
      lastEditedAt: null,
    });

    await tender.save();

    return res.status(201).json({
      success: true,
      data: tender,
    });
  } catch (error) {
    console.error("Tender creation failed:", error);
    return res
      .status(error?.status || 500)
      .json({ success: false, message: error.message });
  }
};

// ✅ 2. Finalize Tender
export const finalizeTender = async (req, res) => {
  try {
    const { quotationId, finalPrice } = req.body;
    console.log(finalPrice);

    // 🔎 Find tender
    const tender = await Tender.findById(req.params.id);
    if (!tender) {
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });
    }

    if (
      tender.selection?.status !== "confirmed" ||
      String(tender.selection?.quotation) !== String(quotationId)
    ) {
      return res.status(409).json({
        success: false,
        message: "Transporter has not confirmed this quotation yet.",
      });
    }

    // idempotent: if already finalized with same quotation → return success
    if (
      tender.status === "finalized" &&
      String(tender.selectedQuotation) === String(quotationId)
    ) {
      return res.status(200).json({
        success: true,
        message: "Tender already finalized (idempotent)",
        tender,
        email: {
          transporterEmailSent: false,
          transporterEmailError: null,
          rrEmailSent: false,
          rrEmailError: null,
        },
      });
    }

    if (tender.status === "finalized" || tender.selectedQuotation) {
      return res.status(400).json({
        success: false,
        message: "Tender has already been finalized and cannot be changed.",
      });
    }

    if (tender.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // Payment must be captured/paid for this tender+quotation+rrUser
    const payRow = await TenderPayment.findOne({
      tenderId: tender._id,
      quotationId,
      rrUserId: req.user.id,
      purpose: "tender_finalization_advance",
      status: { $in: ["paid", "captured"] },
    });

    if (!payRow) {
      return res.status(402).json({
        success: false,
        message:
          "Payment not received for this quotation. Please complete payment first.",
      });
    }

    //  Find quotation
    const quotation = await Quotation.findOne({
      _id: quotationId,
      tender: tender._id,
    });
    if (!quotation) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid quotation" });
    }

    // 🔎 Find transport user
    const transportUser = await userModel.findById(quotation.transportUser);
    if (!transportUser) {
      return res
        .status(400)
        .json({ success: false, message: "Transport user not found" });
    }

    //  RR User (tender creator)
    const rrUser = await userModel.findById(tender.createdBy).lean();
    if (!rrUser) {
      return res
        .status(400)
        .json({ success: false, message: "RR user not found" });
    }

    /* ------------------------------ helpers (NEW) ------------------------------ */

    const join = (...parts) => parts.filter(Boolean).join(", ");

    const formatLocation = (loc) => {
      // New schema (pickup/drop)
      if (loc && typeof loc === "object") {
        const line = join(
          loc.address,
          loc.location,
          loc.city,
          loc.district,
          loc.state,
          loc.pincode,
          loc.country,
        );
        return line || "-";
      }

      // Fallback for old schema (dispatchLocation/address/pincode)
      const legacy = join(
        tender.dispatchLocation,
        tender.address,
        tender.pincode,
      );
      return legacy || "-";
    };

    const pickupText = tender.pickup
      ? formatLocation(tender.pickup)
      : formatLocation(null);
    const dropText = tender.drop ? formatLocation(tender.drop) : "-";

    const vehiclesHtml =
      Array.isArray(tender.vehicleRequirements) &&
      tender.vehicleRequirements.length
        ? `
          <ul style="margin-top:10px; padding-left:20px;">
            ${tender.vehicleRequirements
              .map(
                (v) => `
                <li>
                  ${v.category || "-"} - ${v.subCategory || "-"}
                  ${v.quantity ? ` (Qty: ${v.quantity})` : ""}
                </li>
              `,
              )
              .join("")}
          </ul>
        `
        : "";

    // fallback for your older tenders (materials array)
    const materialsHtml =
      Array.isArray(tender.materials) && tender.materials.length
        ? `
      <div style="margin-top:12px;">
        <div style="font-weight:bold; margin-bottom:8px;">Materials</div>
        <ul style="margin-top:10px; padding-left:20px;">
          ${tender.materials
            .map(
              (mat) => `
              <li>
                <strong>${mat.materialName || "-"}</strong>
                ${mat.hsnCode ? ` [HSN: ${mat.hsnCode}]` : ""}
                ${mat.quantity != null ? ` - Qty: ${mat.quantity}` : ""}
                ${mat.unit ? ` ${mat.unit}` : ""}
                ${mat.remarks ? ` (${mat.remarks})` : ""}
              </li>
            `,
            )
            .join("")}
        </ul>
      </div>
    `
        : "";

    // Use vehicles if present, else fallback to materials (keeps old flow safe)
    const itemsHtml =
      [vehiclesHtml, materialsHtml].filter(Boolean).join("") || "<p>-</p>";

    /* ------------------------------ final save (same) ------------------------------ */

    // ✅ Update tender with finalization
    tender.selectedQuotation = quotation._id;
    tender.finalTransporter = quotation.transportUser;
    tender.finalPrice = finalPrice;
    tender.status = "finalized";
    await tender.save();

    // ✅ Email result to send back to frontend
    let transporterEmailSent = false;
    let rrEmailSent = false;
    let transporterEmailError = null;
    let rrEmailError = null;

    // ✅ Email Notification to Transport User
    try {
      await sendMail({
        to: transportUser.email,
        subject: "🎉 Congratulations! Your Quotation Has Been Accepted - LogiQ",
        html: `
          <div style="margin:0; padding:0; background-color:#f4f4f4;">
            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px; background:#ffffff; margin-top:30px; margin-bottom:30px; border-radius:10px; overflow:hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.15);">
              
              <tr>
                <td align="center" style="background:#ffffff; padding:28px 22px;">
                  <div style="font-family:Arial, sans-serif; font-size:24px; font-weight:800; color:#111827;">
                    LogiQ
                  </div>
                  <div style="font-family:Arial, sans-serif; font-size:13px; margin-top:6px; color:#6b7280;">
                    Reverse Auction System
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px; font-family: Arial, sans-serif; color: #333; font-size: 16px;">

                  <p>Hello <strong>${transportUser.name}</strong>,</p>

                  <p style="margin-top:20px;">
                    🎉 <strong>Congratulations!</strong> Your quotation has been <span style="color: #2E86C1;">ACCEPTED</span> for the following journey:
                  </p>

                  <table cellpadding="5" cellspacing="0" width="100%" style="margin: 20px 0;">
                    <tr>
                      <td style="font-weight:bold;">📍 Pickup Location:</td>
                      <td>${pickupText}</td>
                    </tr>
                    <tr>
                      <td style="font-weight:bold;">📍 Drop Location:</td>
                      <td>${dropText}</td>
                    </tr>
                    <tr>
                      <td style="font-weight:bold;">🚚 Delivery Window:</td>
                      <td>${moment(tender.deliveryWindow.from)
                        .tz("Asia/Kolkata")
                        .format("DD MMM YYYY")} to ${moment(
                        tender.deliveryWindow.to,
                      )
                        .tz("Asia/Kolkata")
                        .format("DD MMM YYYY")}</td>
                    </tr>
                  </table>

                  <p style="margin-top:30px;"><strong>🚛 Vehicle / Items:</strong></p>
                  ${itemsHtml}

                  <p style="margin-top:18px;">
                    <strong>Total Weight:</strong> ${tender.totalWeight ?? "-"} MT<br/>
                    <strong>Total Quantity:</strong> ${tender.totalQuantity ?? "-"}
                  </p>

                  <p style="margin-top:22px;">
                    <strong>✅ Finalized Price:</strong> ₹${finalPrice}
                  </p>

                  <p style="margin-top:30px;">
                    We sincerely appreciate your cooperation. Further communication regarding dispatch schedules will follow shortly.
                  </p>

                  <p style="margin:24px 0 0;">
                    Thanks & Regards,<br/>
                    <strong>LogiQ</strong><br/>
                    <small style="color:#6b7280;">Reverse Auction System</small>
                  </p>

                </td>
              </tr>

              <tr>
                <td style="background-color: #f1f1f1; text-align: center; padding: 15px; font-size: 12px; color: #777;">
                  Building Strong Foundations | <a href="https://www.yuvaq.com/" style="color: #2E86C1; text-decoration: none;">www.yuvaq.com</a>
                </td>
              </tr>

            </table>
          </div>
        `,
      });

      transporterEmailSent = true;
    } catch (emailErr) {
      transporterEmailError =
        emailErr?.message || "Failed to send transporter email";
      console.error(
        "Failed to send finalization email:",
        transporterEmailError,
      );
    }

    // ✅ Email to RR User (creator) with winner contact details
    try {
      await sendMail({
        to: rrUser.email,
        subject:
          "✅ Tender Finalized - Winner Selected (Transporter Contact Details Included) - LogiQ",
        html: `
      <div style="margin:0; padding:0; background-color:#f4f4f4;">
        <table align="center" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#fff;margin:30px auto;border-radius:10px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.15);">
          <tr>
            <td align="center" style="padding:30px;">
              <div style="font-family:Arial;font-size:28px;font-weight:bold;">
                <span style="color:#059669;">LogiQ</span>
              </div>
              <div style="font-family:Arial;font-size:13px;margin-top:5px;color:#777;">
                Reverse Auction System
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 30px;font-family:Arial;color:#333;font-size:15px;">
              <p>Hello <strong>${rrUser.name || "RR User"}</strong>,</p>

              <p style="margin-top:15px;">
                ✅ Your tender has been <strong>FINALIZED</strong>. Below are the tender details and the selected transporter contact details for coordination.
              </p>

              <table cellpadding="8" cellspacing="0" width="100%" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;">
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;width:170px;">Tender</td>
                  <td>${tender.projectName || "-"} (${tender.projectCode || "-"})</td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Purchase Order</td>
                  <td>${tender.purchaseOrder || "-"}</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;">Pickup</td>
                  <td>${pickupText}</td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Drop</td>
                  <td>${dropText}</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;">Delivery Window</td>
                  <td>
                    ${moment(tender.deliveryWindow.from).tz("Asia/Kolkata").format("DD MMM YYYY")}
                    to
                    ${moment(tender.deliveryWindow.to).tz("Asia/Kolkata").format("DD MMM YYYY")}
                  </td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Vehicle / Items</td>
                  <td>${itemsHtml}</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;">Finalized Price</td>
                  <td><strong>₹${Number(finalPrice).toLocaleString("en-IN")}</strong></td>
                </tr>
              </table>

              <h3 style="margin:18px 0 8px;font-size:16px;">🚚 Selected Transporter Contact</h3>
              <table cellpadding="8" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;">
                <tr style="background:#ecfdf5;">
                  <td style="font-weight:bold;width:170px;">Name</td>
                  <td>${transportUser.name || "-"}</td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Email</td>
                  <td>${transportUser.email || "-"}</td>
                </tr>
                <tr style="background:#ecfdf5;">
                  <td style="font-weight:bold;">Phone</td>
                  <td>${transportUser.phone || "-"}</td>
                </tr>
              </table>

              <p style="margin-top:18px;color:#555;">
                You can directly contact the transporter for dispatch scheduling and coordination.
              </p>

              <p style="margin-top:28px;">
                Thanks & Regards,<br/>
                <strong style="font-size:18px;">LogiQ</strong><br/>
                <small style="color:#777;">Reverse Auction System</small>
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f1f1f1;text-align:center;padding:15px;font-size:12px;color:#777;">
              This is an automated email from LogiQ - Reverse Auction System.
            </td>
          </tr>
        </table>
      </div>
    `,
      });

      rrEmailSent = true;
    } catch (e) {
      rrEmailError = e?.message || "Failed to send RR user email";
      console.error("RR user mail error:", rrEmailError);
    }

    res.status(200).json({
      success: true,
      message: "Tender finalized",
      tender,
      email: {
        transporterEmailSent,
        transporterEmailError,
        rrEmailSent,
        rrEmailError,
      },
    });
  } catch (error) {
    console.error("Error in finalizeTender:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ✅ 3. Get All Tenders Created by RR User — pagination only

export const getAllTendersByRRUser = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { userId } = req.query;

    // Build filter: if userId provided, filter by it; else no filter (all tenders)
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId" });
    }
    const filter = userId ? { createdBy: userId } : {};

    const [tenders, total] = await Promise.all([
      Tender.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("selectedQuotation"),
      Tender.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: tenders, // full docs as usual
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ 4. Get Tenders Assigned to a Transporter (excluding already quoted ones)

export const getTendersForTransporter = async (req, res) => {
  try {
    const transporterId = req.user.id;
    const now = new Date();

    // Step 1: Get all open tenders assigned to this transporter and within bidding window
    const tenders = await Tender.find({
      transporters: transporterId,
      status: "open",
      biddingStart: { $lte: now },
      biddingEnd: { $gte: now },
    }).sort({ createdAt: -1 });

    const tenderIds = tenders.map((t) => t._id);

    // Step 2: Get all quotations by this transporter for these tenders
    const transporterQuotations = await Quotation.find({
      transportUser: transporterId,
      tender: { $in: tenderIds },
    }).select("tender");

    const quotedTenderIds = new Set(
      transporterQuotations.map((q) => q.tender.toString()),
    );

    // Count how many times transporter quoted per tender
    const bidCountMap = {};
    transporterQuotations.forEach((q) => {
      const id = q.tender.toString();
      bidCountMap[id] = (bidCountMap[id] || 0) + 1;
    });

    // Step 3: Prepare tender list with hasQuoted and bidsLeft
    const tendersWithStatus = tenders.map((tender) => {
      const tenderObj = tender.toObject();
      const tid = tender._id.toString();
      tenderObj.hasQuoted = quotedTenderIds.has(tid);
      tenderObj.bidsUsed = bidCountMap[tid] || 0;
      tenderObj.bidsRemaining = Math.max(0, 3 - tenderObj.bidsUsed);
      return tenderObj;
    });

    // Step 4: Populate createdBy field
    await Tender.populate(tendersWithStatus, {
      path: "createdBy",
      select: "name email",
    });

    res.status(200).json({ success: true, data: tendersWithStatus });
  } catch (error) {
    console.error("Error in getTendersForTransporter:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

//upcomming tender

export const getUpcomingTendersForTransporter = async (req, res) => {
  try {
    const transporterId = req.user.id;
    const now = new Date();

    // 🟡 Step 1: Find upcoming tenders assigned to this transporter
    const upcomingTenders = await Tender.find({
      transporters: transporterId,
      status: "open",
      biddingStart: { $gt: now },
    })
      .sort({ biddingStart: 1 })
      .populate("createdBy", "name email");

    // 🕒 Step 2: Add biddingOpensIn to each tender
    const tendersWithCountdown = upcomingTenders.map((tender) => {
      const tenderObj = tender.toObject();
      tenderObj.biddingOpensIn =
        new Date(tender.biddingStart).getTime() - now.getTime(); // in milliseconds
      return tenderObj;
    });

    res.status(200).json({ success: true, data: tendersWithCountdown });
  } catch (error) {
    console.error("Error in getUpcomingTendersForTransporter:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ 5. Get Quotations for a Tender
export const getTenderQuotations = async (req, res) => {
  try {
    const tenderId = req.params.id;
    const userId = req.user.id;

    const tender = await Tender.findById(tenderId).populate(
      "createdBy",
      "name email",
    );
    if (!tender) {
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });
    }

    if (tender.createdBy._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const now = new Date();
    if (now < tender.biddingEnd) {
      return res.status(403).json({
        success: false,
        message:
          "Top quotations can be viewed only after the bidding window closes.",
      });
    }

    // -----------------------------
    // 1) Load ALL quotes for tender
    // -----------------------------
    const allQuotes = await Quotation.find({ tender: tenderId })
      .populate("transportUser", "name email")
      .sort({ price: 1, createdAt: 1 });

    // ---------------------------------------------
    // 2) Determine post-bid window (startsAt/endsAt)
    // ---------------------------------------------
    const postBidStatus = String(
      tender.postBid?.status || "inactive",
    ).toLowerCase(); // inactive|active|ended
    const endsAt = tender.postBid?.endsAt
      ? new Date(tender.postBid.endsAt)
      : null;

    // if you store durationMinutes in tender.postBid, use it; else default 10
    const durationMinutes = Number(tender.postBid?.durationMinutes ?? 10);

    // prefer saved startsAt/startedAt if present, else derive from endsAt-duration
    const startsAt =
      (tender.postBid?.startsAt && new Date(tender.postBid.startsAt)) ||
      (tender.postBid?.startedAt && new Date(tender.postBid.startedAt)) ||
      (endsAt
        ? new Date(endsAt.getTime() - durationMinutes * 60 * 1000)
        : null);

    const hasPostBidWindow =
      !!endsAt && !!startsAt && ["active", "ended"].includes(postBidStatus);

    // ---------------------------------------------
    // 3) Identify post-bid quotes (flag OR time-window)
    // ---------------------------------------------
    const isMarkedPostBid = (q) => {
      // covers common schema variants; if fields don't exist, it just evaluates false
      return (
        q?.isPostBid === true ||
        q?.postBid === true ||
        String(q?.bidPhase || "").toLowerCase() === "postbid" ||
        String(q?.bidPhase || "").toLowerCase() === "post_bid" ||
        String(q?.phase || "").toLowerCase() === "postbid" ||
        String(q?.phase || "").toLowerCase() === "post_bid"
      );
    };

    // first try "flag-based"
    let postBidPool = allQuotes.filter(isMarkedPostBid);

    // if no flag-based quotes, fallback to time-window based (if window exists)
    if (postBidPool.length === 0 && hasPostBidWindow) {
      postBidPool = allQuotes.filter((q) => {
        const t = new Date(q.createdAt).getTime();
        return t >= startsAt.getTime() && t <= endsAt.getTime();
      });
    }

    // normal pool should represent "previous ranked quotes" (pre post-bid)
    // If post-bid exists -> exclude postBidPool, else normal = allQuotes
    const postBidIds = new Set(postBidPool.map((q) => String(q._id)));
    const normalPool =
      postBidPool.length > 0
        ? allQuotes.filter((q) => !postBidIds.has(String(q._id)))
        : allQuotes;

    // ---------------------------------------------
    // 4) Helper: best quote per transporter (dedupe)
    // ---------------------------------------------
    const bestPerTransporter = (quotes) => {
      const seen = new Set();
      const best = [];
      for (const q of quotes) {
        const uid = q?.transportUser?._id
          ? String(q.transportUser._id)
          : String(q.transportUser);
        if (!uid) continue;
        if (!seen.has(uid)) {
          seen.add(uid);
          best.push(q);
        }
      }
      return best;
    };

    // "previous ranked quotations" = best per transporter from NORMAL pool
    const bestNormalQuotes = bestPerTransporter(normalPool).sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      if (ap !== bp) return ap - bp;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const top3Normal = bestNormalQuotes.slice(0, 3);

    // selectionHistory map
    const hist = tender.selectionHistory || [];
    const reasonByQ = {};
    const byRoleByQ = {};

    for (const h of hist) {
      if (!h?.quotation) continue;
      if (["reject", "reopen", "remove"].includes(h.action)) {
        reasonByQ[String(h.quotation)] = h.reason || "";
        byRoleByQ[String(h.quotation)] = h.byRole || "rr";
      }
    }

    const reopenCount = tender.reopenCount || 0;

    // normal ranks: L1 L2 L3
    const rankedNormalTop3 = top3Normal.map((q, index) => {
      const qid = String(q._id);

      const signedFiles = (q.files || []).map((file) => {
        const key = file.url?.split("/").pop();
        return { ...file, url: generateSignedUrl(key) };
      });

      const eligible = index >= reopenCount;

      return {
        rank: `L${index + 1}`,
        transportUser: q.transportUser,
        price: q.price,
        vehicleNumber: q.vehicleNumber,
        createdAt: q.createdAt,
        files: signedFiles,
        _id: q._id,

        eligible,
        removedReason: !eligible ? reasonByQ[qid] || "" : "",
        removedBy: !eligible ? byRoleByQ[qid] || "rr" : "",
        isPostBid: false,
      };
    });

    // ---------------------------------------------
    // 5) Post-bid ranked quotes (best per transporter)
    // ---------------------------------------------
    const bestPostBidQuotes = bestPerTransporter(postBidPool).sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      if (ap !== bp) return ap - bp;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const postBidRanked = bestPostBidQuotes.map((q, index) => {
      const signedFiles = (q.files || []).map((file) => {
        const key = file.url?.split("/").pop();
        return { ...file, url: generateSignedUrl(key) };
      });

      return {
        // keep distinct rank so UI doesn’t confuse with normal L1/L2/L3
        rank: `PB${index + 1}`,
        transportUser: q.transportUser,
        price: q.price,
        vehicleNumber: q.vehicleNumber,
        createdAt: q.createdAt,
        files: signedFiles,
        _id: q._id,
        eligible: true,
        removedReason: "",
        removedBy: "",
        isPostBid: true,
      };
    });

    const postBidRankedOrEmpty = Array.isArray(postBidRanked)
      ? postBidRanked
      : [];

    // combined: if post-bid exists show it along with previous ranked
    const combinedForUI =
      postBidRankedOrEmpty.length > 0
        ? [...postBidRankedOrEmpty, ...rankedNormalTop3]
        : rankedNormalTop3;

    return res.status(200).json({
      success: true,
      data: {
        postBid: {
          enabled: tender.postBid?.enabled || false,
          status: tender.postBid?.status || "inactive",
          endsAt: tender.postBid?.endsAt || null,
          remainingMs: tender.postBid?.endsAt
            ? Math.max(
                0,
                new Date(tender.postBid.endsAt).getTime() - Date.now(),
              )
            : 0,
          quotes: postBidRankedOrEmpty,
          message: postBidRankedOrEmpty.length
            ? null
            : "No quotations in the post bid.",
        },
        normal: rankedNormalTop3,
        combinedForUI,
      },
    });
  } catch (error) {
    console.error("Error fetching top quotations:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

//reopen tender
export const reopenTender = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === "") {
      return res.status(400).json({ error: "Reason is required." });
    }

    const tender = await Tender.findById(id);
    if (!tender)
      return res.status(404).json({ success: false, message: "Not found" });

    if (tender.reopenCount >= 2) {
      return res.status(403).json({
        success: false,
        message:
          "This tender has already been reopened twice and cannot be reopened again.",
      });
    }

    const removedQuotationId =
      tender.selectedQuotation || tender.selection?.quotation || null;

    const removedTransporterId =
      tender.finalTransporter || tender.selection?.transporter || null;

    if (removedQuotationId) {
      pushSelectionHistory(tender, {
        action: "reopen",
        status: "reopened",
        quotation: removedQuotationId,
        transporter: removedTransporterId,
        reason: reason.trim(),
        byRole: "rr",
      });
    }

    // keep selection consistent (avoid null surprises)
    tender.selection = {
      status: "none",
      quotation: null,
      transporter: null,
      requestedAt: null,
      respondedAt: null,
      response: null,
      rejectReason: "",
    };

    // ✅ IMPORTANT: clear selection so UI can show button for next rank
    tender.selection = null;

    // reopen core fields
    tender.status = "open";
    tender.selectedQuotation = null;
    tender.finalTransporter = null;
    tender.finalPrice = null;
    tender.reopenCount = (tender.reopenCount || 0) + 1;

    await tender.save();

    res.status(200).json({
      success: true,
      message: "Tender reopened successfully",
      reopenCount: tender.reopenCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ 6. Get Single Tender
export const getSingleTender = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("quotations")
      .populate("selectedQuotation");

    if (!tender) {
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });
    }

    res.status(200).json({ success: true, data: tender });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ✅ 7. Delete Tender (by RR User)
export const deleteTender = async (req, res) => {
  try {
    const tenderId = req.params.id;
    const userId = req.user.id;

    const { reason } = req.body || {};
    const cleanReason = String(reason || "").trim();

    if (!cleanReason) {
      return res.status(400).json({
        success: false,
        message: "Reason is required to delete/cancel a tender.",
      });
    }

    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });
    }

    if (String(tender.createdBy) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // Idempotent: already cancelled
    if (String(tender.status).toLowerCase() === "cancelled") {
      return res.status(200).json({
        success: true,
        message: "Tender already cancelled.",
        data: tender,
      });
    }

    const now = new Date();

    // ✅ Rule 1: only before biddingStart
    const biddingStart = tender?.biddingStart
      ? new Date(tender.biddingStart)
      : null;
    if (biddingStart && now.getTime() >= biddingStart.getTime()) {
      return res.status(409).json({
        success: false,
        code: "BIDDING_ALREADY_STARTED",
        message: "Tender cannot be deleted once bidding has started.",
      });
    }

    // ✅ Rule 2: max 3 cancellations per day (IST)
    const tz = "Asia/Kolkata";
    const dayStart = moment().tz(tz).startOf("day").toDate();
    const dayEnd = moment().tz(tz).endOf("day").toDate();

    const todayCancelledCount = await Tender.countDocuments({
      createdBy: userId,
      status: "cancelled",
      cancelledAt: { $gte: dayStart, $lte: dayEnd },
    });

    if (todayCancelledCount >= 3) {
      return res.status(429).json({
        success: false,
        code: "DAILY_DELETE_LIMIT",
        message:
          "Daily delete limit reached (3/day). Please contact support with a genuine reason to delete more tenders.",
      });
    }

    // ✅ Soft-delete (cancel)
    tender.status = "cancelled";
    tender.cancelledAt = now;
    tender.cancelledBy = userId;
    tender.cancelledReason = cleanReason;

    await tender.save();

    // ✅ Email all selected transporters
    const transporterIds = Array.isArray(tender.transporters)
      ? tender.transporters
      : [];
    const transporters = await User.find({ _id: { $in: transporterIds } })
      .select("name email")
      .lean();

    const pickupText = tender.pickup
      ? [
          tender.pickup.address,
          tender.pickup.city,
          tender.pickup.district,
          tender.pickup.state,
          tender.pickup.pincode,
        ]
          .filter(Boolean)
          .join(", ")
      : "-";

    const dropText = tender.drop
      ? [
          tender.drop.address,
          tender.drop.city,
          tender.drop.district,
          tender.drop.state,
          tender.drop.pincode,
        ]
          .filter(Boolean)
          .join(", ")
      : "-";

    const biddingStartIst = tender.biddingStart
      ? moment(tender.biddingStart).tz(tz).format("DD MMM YYYY, hh:mm A")
      : "-";

    let sent = 0;
    let failed = 0;

    for (const tr of transporters) {
      if (!tr?.email) continue;

      try {
        await sendMail({
          to: tr.email,
          subject: "❌ Tender Cancelled — Please Ignore (LogiQ)",
          html: `
            <div style="font-family:Arial;line-height:1.5">
              <h2 style="margin:0 0 10px;color:#dc2626">Tender Cancelled</h2>
              <p>Hello <b>${tr.name || "Transporter"}</b>,</p>

              <p>
                This is to inform you that the tender has been <b>cancelled</b> by the creator
                <b>before bidding started</b>.
              </p>

              <table cellpadding="8" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:10px;">
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;width:170px;">Project</td>
                  <td>${tender.projectName || "-"} (${tender.projectCode || "-"})</td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Purchase Order</td>
                  <td>${tender.purchaseOrder || "-"}</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;">Pickup</td>
                  <td>${pickupText}</td>
                </tr>
                <tr>
                  <td style="font-weight:bold;">Drop</td>
                  <td>${dropText}</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="font-weight:bold;">Bidding Start</td>
                  <td>${biddingStartIst}</td>
                </tr>
              </table>

              <p style="margin-top:14px;"><b>Cancellation Reason:</b> ${cleanReason}</p>

              <p style="margin-top:18px;color:#6b7280;font-size:12px">
                This is an automated message from LogiQ.
              </p>
            </div>
          `,
        });

        sent += 1;
      } catch (e) {
        failed += 1;
        console.error("cancel mail failed:", tr.email, e?.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Tender cancelled successfully.",
      data: tender,
      mail: { total: transporters.length, sent, failed },
      limits: { todayCancelledCount: todayCancelledCount + 1, dailyLimit: 3 },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get Quotation History for Transporter
export const getQuotationHistoryForTransporter = async (req, res) => {
  try {
    const transporterId = new mongoose.Types.ObjectId(req.user.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0); // normalize to start of today

    // ✅ Get all quotations by this transporter, grouped by tender
    const quotations = await Quotation.find({ transportUser: transporterId })
      .populate({
        path: "tender",
        populate: {
          path: "createdBy",
          select: "name email",
        },
      })
      .sort({ createdAt: 1 });

    const tenderQuotesMap = new Map();

    // ✅ Group quotations by tender ID (and skip tenders whose closeDate >= today)
    for (const q of quotations) {
      const tender = q.tender;
      const tenderId = tender?._id?.toString();
      if (!tenderId) continue;

      const biddingEndTime = new Date(tender.biddingEnd);
      if (biddingEndTime > new Date()) continue;

      if (!tenderQuotesMap.has(tenderId)) {
        tenderQuotesMap.set(tenderId, []);
      }
      tenderQuotesMap.get(tenderId).push(q);
    }

    const result = [];

    for (const [tenderId, tenderQuotes] of tenderQuotesMap.entries()) {
      const tender = tenderQuotes[0].tender;

      // ✅ Determine if any of the quotations match the selectedQuotation
      const isSelected =
        tender.selectedQuotation &&
        tenderQuotes.some(
          (q) => q._id.toString() === tender.selectedQuotation.toString(),
        );

      const formattedQuotes = tenderQuotes.map((q) => {
        const signedFiles = (q.files || []).map((file) => {
          const key = file.url?.split("/").pop();
          return {
            ...file,
            url: generateSignedUrl(key),
          };
        });

        return {
          _id: q._id,
          price: q.price,
          vehicleNumber: q.vehicleNumber,
          createdAt: q.createdAt,
          files: signedFiles,
        };
      });

      result.push({
        tenderId: tender._id,
        tender: {
          // ✅ NEW: pickup/drop instead of dispatchLocation/address
          pickup: tender.pickup || null,
          drop: tender.drop || null,

          materials: Array.isArray(tender.materials) ? tender.materials : [],

          // ✅ NEW: vehicleRequirements instead of materials
          vehicleRequirements: Array.isArray(tender.vehicleRequirements)
            ? tender.vehicleRequirements
            : [],

          deliveryWindow: tender.deliveryWindow || { from: null, to: null },
          closeDate: tender.closeDate,
          status: tender.status,
          remarks: tender.remarks,

          totalWeight: tender.totalWeight,
          totalQuantity: tender.totalQuantity,
          createdBy: tender.createdBy || null,
          // minBidAmount : tender.minBidAmount,
          // maxBidAmount: tender.maxBidAmount,
          // maxBidUnit: tender.maxBidUnit || null,
          finalizedStatus: isSelected
            ? "Your quotation was finalized"
            : "Your quotation was not selected",
        },
        quotations: formattedQuotes,
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching quotation history:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ all finalized tenders

// export const getAllFinalizedTendersWithQuotations = async (req, res) => {
//   try {
//     const rrUserId = req.user.id;

//     // ✅ Get all finalized tenders created by this RR user
//     const finalizedTenders = await Tender.find({
//       createdBy: rrUserId,
//       status: "finalized",
//     })
//       .populate({
//         path: "selectedQuotation",
//         populate: { path: "transportUser", select: "name email" },
//       })
//       .populate("createdBy", "name email")
//       .sort({ updatedAt: -1 });

//     const results = [];

//     for (const tender of finalizedTenders) {
//       // ✅ Get all quotations for this tender
//       const quotations = await Quotation.find({ tender: tender._id })
//         .populate("transportUser", "name email")
//         .sort({ createdAt: -1 });

//       const allQuotations = quotations.map((q) => {
//         const signedFiles = (q.files || []).map((file) => {
//           const key = file.url?.split("/").pop();
//           return {
//             ...file,
//             url: generateSignedUrl(key),
//           };
//         });

//         return {
//           _id: q._id,
//           price: q.price,
//           vehicleNumber: q.vehicleNumber,
//           createdAt: q.createdAt,
//           transportUser: q.transportUser,
//           files: signedFiles,
//         };
//       });

//       const selectedQuotationId = tender.selectedQuotation?._id?.toString();

//       results.push({
//         tender: {
//           _id: tender._id,
//           dispatchLocation: tender.dispatchLocation,
//           address: tender.address,
//           deliveryWindow: tender.deliveryWindow, // ✅ Updated from dateOfDelivery
//           closeDate: tender.closeDate,
//           remarks: tender.remarks,
//           status: tender.status,
//           finalPrice: tender.finalPrice,
//           materials: tender.materials,
//           totalWeight: tender.totalWeight,
//           totalQuantity: tender.totalQuantity,
//           createdBy: tender.createdBy,
//         },
//         selectedQuotation: tender.selectedQuotation
//           ? {
//               _id: tender.selectedQuotation._id,
//               price: tender.selectedQuotation.price,
//               vehicleNumber: tender.selectedQuotation.vehicleNumber,
//               transportUser: tender.selectedQuotation.transportUser,
//               files: (tender.selectedQuotation.files || []).map((file) => {
//                 const key = file.url?.split("/").pop();
//                 return {
//                   ...file,
//                   url: generateSignedUrl(key),
//                 };
//               }),
//             }
//           : null,
//         allQuotations: allQuotations.map((q) => ({
//           ...q,
//           selected: q._id.toString() === selectedQuotationId,
//         })),
//       });
//     }

//     res.status(200).json({ success: true, data: results });
//   } catch (error) {
//     console.error("Error fetching finalized tenders for RR user:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

//your position for transporters

export const getMyQuotationPosition = async (req, res) => {
  try {
    const { tenderId } = req.params;
    const userId = req.user.id;

    console.log("Fetching position for tenderId:", tenderId);

    // ✅ Validate Tender ID
    if (!tenderId || !mongoose.Types.ObjectId.isValid(tenderId)) {
      return res.status(400).json({ message: "Invalid or missing Tender ID" });
    }

    // ✅ Get all quotations for the tender, sorted by price + createdAt
    const allQuotes = await Quotation.find({
      tender: tenderId,
      phase: "normal",
    }).sort({
      price: 1,
      createdAt: 1,
    });

    // ✅ Group best (lowest) quote per transporter
    const bestQuotesMap = new Map(); // transportUserId => bestQuotation

    for (const quote of allQuotes) {
      const uid = quote.transportUser.toString();
      if (!bestQuotesMap.has(uid)) {
        bestQuotesMap.set(uid, quote); // first lowest quote per transporter
      }
    }

    // ✅ Sort those best quotes by price (and createdAt to break ties)
    const sortedBestQuotes = Array.from(bestQuotesMap.entries()).sort(
      ([, q1], [, q2]) => {
        if (q1.price === q2.price) {
          return new Date(q1.createdAt) - new Date(q2.createdAt);
        }
        return q1.price - q2.price;
      },
    );

    // ✅ EXTRA: L1 info (anonymous, only price + time)
    const l1Entry = sortedBestQuotes[0];
    const l1Quote = l1Entry?.[1] || null;

    const l1 = l1Quote
      ? {
          price: l1Quote.price,
          createdAt: l1Quote.createdAt,
        }
      : null;

    // ✅ Find current user's rank + their best quote
    let position = null;
    let bestQuote = null;

    for (let i = 0; i < sortedBestQuotes.length; i++) {
      const [uid, quote] = sortedBestQuotes[i];
      if (uid === userId) {
        position = `L${i + 1}`;
        bestQuote = {
          _id: quote._id,
          price: quote.price,
          vehicleNumber: quote.vehicleNumber,
          createdAt: quote.createdAt,
        };
        break;
      }
    }

    // ✅ No bids yet?
    if (!bestQuote) {
      return res.status(200).json({
        position: null,
        message: "You have not submitted any bids yet.",
      });
    }

    // ✅ Success response with rank + best bid
    res.status(200).json({
      position,
      bestQuotation: bestQuote,
      l1,
    });
  } catch (error) {
    console.error("Error getting bid position:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/tenders/:id/notify
 * Optional body:
 *  - transporterIds?: string[]  // override: notify these users only (subset)
 *  - dryRun?: boolean           // if true, nothing is sent; payload preview returned
 */
// export const notifyTenderTransporters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.isValidObjectId(id)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid tender id" });
//     }

//     const tender = await Tender.findById(id).lean();
//     if (!tender) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Tender not found" });
//     }

//     // Ensure tender has transporter IDs
//     const tenderTransporters = Array.isArray(tender.transporters)
//       ? tender.transporters
//       : [];
//     if (tenderTransporters.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "No transporters attached to this tender",
//       });
//     }

//     // Optional override: only notify given transporterIds (must be subset)
//     const { transporterIds = [], dryRun = false } = req.body || {};
//     let targetIds = tenderTransporters.map(String);

//     if (Array.isArray(transporterIds) && transporterIds.length > 0) {
//       const override = transporterIds.filter((x) =>
//         targetIds.includes(String(x)),
//       );
//       if (override.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "Provided transporterIds are not part of this tender",
//         });
//       }
//       targetIds = override;
//     }

//     // Load users
//     const users = await User.find({
//       _id: { $in: targetIds.map((x) => new mongoose.Types.ObjectId(x)) },
//     })
//       .select("_id name phone")
//       .lean();

//     const timezone = "Asia/Kolkata";

//     // Build template values from tender
//     const values = {
//       dispatch_location: `${tender.dispatchLocation} (${tender.pincode || ""})`,
//       delivery_from: moment(tender?.deliveryWindow?.from)
//         .tz(timezone)
//         .format("DD MMM YYYY"),
//       delivery_to: moment(tender?.deliveryWindow?.to)
//         .tz(timezone)
//         .format("DD MMM YYYY"),
//       start_datetime: moment(tender?.biddingStart)
//         .tz(timezone)
//         .format("DD MMM YYYY, hh:mm A"),
//       end_datetime: moment(tender?.biddingEnd)
//         .tz(timezone)
//         .format("DD MMM YYYY, hh:mm A"),
//       // You can add more fields if your template has them:
//       // project_name: tender.projectName,
//       // project_code: tender.projectCode,
//       // purchase_order: tender.purchaseOrder,
//     };

//     // If dryRun: return preview without sending
//     if (dryRun) {
//       return res.json({
//         success: true,
//         dryRun: true,
//         templatePreview: values,
//         recipientsPreview: users.map((u) => ({
//           id: u._id,
//           name: u.name,
//           phone: u.phone || null,
//         })),
//       });
//     }

//     // Send to users who have phone numbers
//     const results = [];
//     let sent = 0;
//     let skipped = 0;

//     for (const u of users) {
//       if (!u.phone) {
//         results.push({
//           userId: u._id,
//           name: u.name || "",
//           status: "skipped",
//           reason: "missing_phone",
//         });
//         skipped += 1;
//         continue;
//       }
//       try {
//         await sendWhatsAppTemplate(u.phone, values);
//         results.push({
//           userId: u._id,
//           name: u.name || "",
//           phone: u.phone,
//           status: "sent",
//         });
//         sent += 1;
//       } catch (e) {
//         results.push({
//           userId: u._id,
//           name: u.name || "",
//           phone: u.phone,
//           status: "failed",
//           error: e.message,
//         });
//       }
//     }

//     return res.json({
//       success: true,
//       tenderId: id,
//       counts: {
//         total: users.length,
//         sent,
//         skipped,
//         failed: results.filter((r) => r.status === "failed").length,
//       },
//       valuesUsed: values,
//       results,
//     });
//   } catch (err) {
//     console.error("notifyTenderTransporters error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to send WhatsApp notifications",
//     });
//   }
// };

export const notifyTenderTransporters = async (req, res) => {
  try {
    const out = await notifyTenderTransportersInternal(
      req.params.id,
      req.body || {},
    );
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getFinalizedTransporterContact = async (req, res) => {
  try {
    const { id: tenderId } = req.params;
    const requesterId = req.user.id;

    if (!mongoose.isValidObjectId(tenderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tender id" });
    }

    const tender = await Tender.findById(tenderId)
      .select("status createdBy finalTransporter selectedQuotation")
      .lean();

    if (!tender) {
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });
    }

    // ✅ Only tender creator can reveal
    if (String(tender.createdBy) !== String(requesterId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // ✅ Must be finalized
    if (tender.status !== "finalized") {
      return res.status(400).json({
        success: false,
        message: "Tender is not finalized yet",
      });
    }

    // Try to resolve finalized transporter id
    let transporterId = tender.finalTransporter;

    // fallback if old data: take selectedQuotation.transportUser
    if (!transporterId && tender.selectedQuotation) {
      const q = await Quotation.findById(tender.selectedQuotation)
        .select("transportUser")
        .lean();
      transporterId = q?.transportUser;
    }

    if (!transporterId || !mongoose.isValidObjectId(transporterId)) {
      return res.status(404).json({
        success: false,
        message: "Finalized transporter not found for this tender",
      });
    }

    const transporter = await User.findById(transporterId)
      .select("name email phone")
      .lean();

    if (!transporter) {
      return res
        .status(404)
        .json({ success: false, message: "Transporter user not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        transporterId: transporter._id,
        name: transporter.name || "",
        email: transporter.email || "",
        phone: transporter.phone || "",
      },
    });
  } catch (error) {
    console.error("getFinalizedTransporterContact error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const requestSelectionConfirmation = async (req, res) => {
  try {
    const tenderId = req.params.id;
    const { quotationId } = req.body;

    if (
      !mongoose.isValidObjectId(tenderId) ||
      !mongoose.isValidObjectId(quotationId)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tenderId/quotationId" });
    }

    const tender = await Tender.findById(tenderId);
    if (!tender)
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });

    // only creator can request
    if (String(tender.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (tender.status === "finalized") {
      return res
        .status(400)
        .json({ success: false, message: "Tender already finalized" });
    }

    // block if already pending/confirmed
    if (tender.selection?.status === "pending") {
      return res.status(409).json({
        success: false,
        message: "A transporter confirmation is already pending.",
      });
    }
    if (tender.selection?.status === "confirmed") {
      return res.status(409).json({
        success: false,
        message: "Selection already confirmed. Proceed to payment.",
      });
    }

    if (tender.postBid?.status === "active" && tender.postBid?.endsAt) {
      const now = new Date();
      if (now < new Date(tender.postBid.endsAt)) {
        return res.status(409).json({
          success: false,
          message:
            "Post-bid negotiation is active. Please wait until it ends to select.",
          endsAt: tender.postBid.endsAt,
        });
      }
    }

    // optional: allow only after bidding end
    const now = new Date();
    if (tender.biddingEnd && now < new Date(tender.biddingEnd)) {
      return res.status(403).json({
        success: false,
        message: "You can request confirmation only after bidding ends.",
      });
    }

    const quotation = await Quotation.findOne({
      _id: quotationId,
      tender: tender._id,
    });
    if (!quotation)
      return res
        .status(400)
        .json({ success: false, message: "Invalid quotation for this tender" });

    // set selection pending
    tender.selection = {
      status: "pending",
      quotation: quotation._id,
      transporter: quotation.transportUser,
      requestedAt: new Date(),
      respondedAt: null,
      response: null,
      rejectReason: "",
    };

    pushSelectionHistory(tender, {
      action: "request",
      status: "pending",
      quotation: quotation._id,
      transporter: quotation.transportUser,
      reason: "",
      byRole: "rr",
    });

    await tender.save();

    // notify transporter by email (your “message goes to them”)
    try {
      const transporter = await userModel
        .findById(quotation.transportUser)
        .lean();
      if (transporter?.email) {
        await sendMail({
          to: transporter.email,
          subject: "Your Quotation is Selected — Please Confirm (LogiQ)",
          html: `
            <div style="font-family:Arial;line-height:1.5">
              <h2 style="margin:0 0 10px;color:#059669">LogiQ</h2>
              <p>Hello <b>${transporter.name || "Transporter"}</b>,</p>
              <p>Your quotation has been selected for the tender below. Please open your Transporter Dashboard and <b>Accept/Reject</b>.</p>
              <table cellpadding="6" style="border:1px solid #e5e7eb;border-radius:8px">
                <tr><td><b>Project</b></td><td>${tender.projectName || "-"}</td></tr>
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
                <tr><td><b>Delivery</b></td><td>${
                  tender.deliveryWindow?.from && tender.deliveryWindow?.to
                    ? `${moment(tender.deliveryWindow.from).tz("Asia/Kolkata").format("DD MMM YYYY")} → ${moment(tender.deliveryWindow.to).tz("Asia/Kolkata").format("DD MMM YYYY")}`
                    : "-"
                }</td></tr>
                <tr><td><b>Your Price</b></td><td>₹${Number(quotation.price).toLocaleString("en-IN")} / MT</td></tr>
              </table>
              <p style="margin-top:12px;color:#6b7280">If you do not respond, RR user cannot proceed to payment & finalization.</p>
            </div>
          `,
        });
      }
    } catch (e) {
      // non-blocking
      console.error("Selection email failed:", e?.message);
    }

    return res
      .status(200)
      .json({ success: true, message: "Confirmation requested", data: tender });
  } catch (error) {
    console.error("requestSelectionConfirmation:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const respondSelectionConfirmation = async (req, res) => {
  try {
    const tenderId = req.params.id;
    const { action, reason } = req.body; // action: 'accept' | 'reject'

    if (!mongoose.isValidObjectId(tenderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tenderId" });
    }

    const tender = await Tender.findById(tenderId);
    if (!tender)
      return res
        .status(404)
        .json({ success: false, message: "Tender not found" });

    if (tender.selection?.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "No pending confirmation for this tender.",
      });
    }

    if (String(tender.selection.transporter) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: not selected transporter",
      });
    }

    if (!["accept", "reject"].includes(action)) {
      return res
        .status(400)
        .json({ success: false, message: "action must be accept/reject" });
    }

    if (action === "reject" && !String(reason || "").trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Reject reason is required" });
    }

    tender.selection.respondedAt = new Date();

    const feePercent = Number(process.env.CONFIRM_ACCEPT_FEE_PERCENT || 0);

    if (action === "accept" && feePercent > 0) {
      const quotationId = String(tender.selection?.quotation || "");
      const payRow = await TenderPayment.findOne({
        tenderId,
        quotationId,
        rrUserId: req.user.id, // payer (transporter)
        purpose: "selection_confirmation_fee",
        status: { $in: ["paid", "captured"] },
      }).lean();

      if (!payRow) {
        return res.status(402).json({
          success: false,
          message: "Payment required to accept this confirmation.",
        });
      }
    }

    if (action === "accept") {
      tender.selection.status = "confirmed";
      tender.selection.response = "accepted";
      tender.selection.rejectReason = "";
    } else {
      tender.selection.status = "rejected";
      tender.selection.response = "rejected";
      tender.selection.rejectReason = String(reason || "").trim();
    }

    const selQ = tender.selection?.quotation || null;

    pushSelectionHistory(tender, {
      action: action === "accept" ? "accept" : "reject",
      status: action === "accept" ? "confirmed" : "rejected",
      quotation: selQ,
      transporter: req.user.id,
      reason: action === "reject" ? tender.selection.rejectReason : "",
      byRole: "transporter",
    });

    await tender.save();

    // notify RR user (optional but useful)
    try {
      const rrUser = await userModel.findById(tender.createdBy).lean();
      if (rrUser?.email) {
        await sendMail({
          to: rrUser.email,
          subject:
            action === "accept"
              ? "✅ Transporter Confirmed — You Can Proceed to Payment (LogiQ)"
              : "❌ Transporter Rejected — Please Select Next Quote (LogiQ)",
          html: `
            <div style="font-family:Arial;line-height:1.5">
              <h2 style="margin:0 0 10px;color:#059669">LogiQ</h2>
              <p>Hello <b>${rrUser.name || "RR User"}</b>,</p>
              <p>Selected transporter has <b>${action === "accept" ? "ACCEPTED" : "REJECTED"}</b> the confirmation request.</p>
              ${action === "reject" ? `<p><b>Reason:</b> ${tender.selection.rejectReason}</p>` : ""}
              <p><b>Project:</b> ${tender.projectName || "-"}</p>
            </div>
          `,
        });
      }
    } catch (e) {
      console.error("RR notify mail failed:", e?.message);
    }

    return res
      .status(200)
      .json({ success: true, message: "Response recorded", data: tender });
  } catch (error) {
    console.error("respondSelectionConfirmation:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPendingConfirmationsForTransporter = async (req, res) => {
  try {
    const transporterId = req.user.id;

    const tenders = await Tender.find({
      "selection.status": "pending",
      "selection.transporter": transporterId,
    })
      .sort({ "selection.requestedAt": -1 })
      .select(
        [
          "projectName",
          "projectCode",
          "projectRemark", //  remark
          "pickup",
          "drop",
          "closeDate", //  close date
          "deliveryWindow",
          "materials",
          "vehicleRequirements",
          "status",
          "selection", // contains quotation + requestedAt + etc
          "createdBy", //  who sent (RR user)
        ].join(" "),
      )
      .populate({
        path: "createdBy",
        select: "name email phone", // show RR sender identity
      })
      .populate({
        path: "selection.quotation",
        select: "price vehicleNumber rank createdAt files", // helpful context for transporter
      })
      .lean();

    // Optional: if you store selection.requestedBy in DB, prefer that instead of createdBy:
    // const requestedBy = t.selection?.requestedBy || t.createdBy

    const data = tenders.map((t) => ({
      _id: t._id,

      // project/tender details
      // projectName: t.projectName,
      // projectCode: t.projectCode,
      // projectRemark: t.projectRemark || "",

      // ✅ NEW: pickup/drop instead of dispatchLocation/address/pincode
      pickup: t.pickup || null,
      drop: t.drop || null,

      closeDate: t.closeDate,
      deliveryWindow: t.deliveryWindow,

      materials: Array.isArray(t.materials) ? t.materials : [],

      // ✅ NEW: vehicleRequirements instead of materials
      vehicleRequirements: Array.isArray(t.vehicleRequirements)
        ? t.vehicleRequirements
        : [],

      status: t.status,

      // selection meta
      selection: {
        status: t.selection?.status,
        requestedAt: t.selection?.requestedAt,
        transporter: t.selection?.transporter,
      },

      // selected quotation details (what transporter is confirming)
      quotation: t.selection?.quotation || null,

      // who sent the request (RR)
      requestedBy: t.createdBy || null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
