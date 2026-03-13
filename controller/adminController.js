import userModel from "../models/userSchema.js";
import Tender from "../models/tenderSchema.js";
import nodemailer from "nodemailer";
import Quotation from "../models/quotationSchema.js";
import { generateSignedUrl } from "../utils/minioClient.js";
import VehicleCatalog from "../models/vehicleCatalogSchema.js";
import TransporterVehicle from "../models/transporterVehicleSchema.js";

// Get all users pending approval
export const getPendingApprovals = async (req, res) => {
  try {
    const pendingUsers = await userModel
      .find({
        role: { $in: ["user", "transportUser"] },
        isApproved: false,
      })
      .select("-password");

    return res.status(200).json({
      success: true,
      count: pendingUsers.length,
      data: pendingUsers,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Approve a user
export const approveUserTwoStep = async (req, res) => {
  const { userId } = req.params;
  const approverId = req.user?.id; // set by your auth middleware
  const approverRole = req.user?.role; // "admin", etc.

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "User ID is required" });
  }
  if (approverRole !== "admin") {
    return res
      .status(403)
      .json({ success: false, message: "Only admins can approve" });
  }

  try {
    const target = await userModel.findById(userId);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (target.isApproved) {
      // Already finalized — we still might need to return state
      return res.status(200).json({
        success: true,
        message: "User already fully approved",
        data: {
          id: target._id,
          name: target.name,
          email: target.email,
          role: target.role,
          isApproved: true,
          currentApprovals: target.approvals?.approvedBy?.length || 0,
          requiredApprovals: target.approvals?.requiredApprovals || 2,
          finalizedAt: target.approvals?.finalizedAt || null,
        },
      });
    }

    // 1) Idempotent add: record this admin's approval only if not present
    const added = await userModel.findOneAndUpdate(
      {
        _id: userId,
        isApproved: false,
        "approvals.approvedBy": { $ne: approverId },
      },
      {
        $addToSet: { "approvals.approvedBy": approverId },
        $setOnInsert: { "approvals.requiredApprovals": 2 },
      },
      { new: true },
    );

    if (!added) {
      // Couldn't add — maybe same admin or race
      const fresh = await userModel.findById(userId);
      const alreadyThisAdmin = fresh?.approvals?.approvedBy?.some(
        (id) => String(id) === String(approverId),
      );
      return res.status(200).json({
        success: true,
        message: alreadyThisAdmin
          ? "Your approval was already recorded"
          : fresh?.isApproved
            ? "User already fully approved"
            : "Approval not recorded (possibly a race). Try again.",
        data: fresh
          ? {
              id: fresh._id,
              isApproved: fresh.isApproved,
              currentApprovals: fresh.approvals?.approvedBy?.length || 0,
              requiredApprovals: fresh.approvals?.requiredApprovals || 2,
              finalizedAt: fresh.approvals?.finalizedAt || null,
            }
          : undefined,
      });
    }

    const currentApprovals = added.approvals?.approvedBy?.length || 0;
    const required = added.approvals?.requiredApprovals || 2;

    // 2) If threshold met, flip isApproved exactly once
    let finalDoc = added;
    if (currentApprovals >= required && !added.isApproved) {
      const finalized = await userModel.findOneAndUpdate(
        { _id: userId, isApproved: false },
        { $set: { isApproved: true, "approvals.finalizedAt": new Date() } },
        { new: true },
      );
      if (finalized) {
        finalDoc = finalized;
      }
    }

    // 3) EMAIL GATE: send only once when finally approved
    // Try to "lock" the notification by setting notifiedAt if still null
    let shouldSendEmail = false;
    let notifyDoc = finalDoc;

    if (finalDoc.isApproved) {
      const locked = await userModel.findOneAndUpdate(
        {
          _id: userId,
          isApproved: true,
          "approvals.finalizedAt": { $ne: null },
          $or: [
            { "approvals.notifiedAt": { $exists: false } }, // if field didn't exist yet
            { "approvals.notifiedAt": null }, // or still null
          ],
        },
        { $set: { "approvals.notifiedAt": new Date() } },
        { new: true },
      );

      if (locked) {
        // We won the lock -> we are the only request that should send the email
        shouldSendEmail = true;
        notifyDoc = locked;
      }
    }

    if (shouldSendEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });

        await transporter.sendMail({
          to: notifyDoc.email,
          from: process.env.SMTP_USER,
          subject: "Account Approved for RRISPAT",
          html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Account Approved</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6;">
  <p>Hello ${notifyDoc.name},</p>
  <p>Your transport user account has been <strong>approved</strong> by the admins. You can now log in:</p>
  <p><a href="https://logiyatra.rrispat.in">Click here to login</a></p>
  <p>Thank you for your patience.</p>
  <br/>
  <p>Best regards,</p>
  <p><strong>RR ISPAT Support Team</strong><br/>
    Email: techsupport@rrispat.com<br/>
    Website: <a href="https://project.rrispat.in">rrispat.com</a>
  </p>
</body></html>`,
        });
      } catch (e) {
        console.error("Error sending final approval email:", e);
        // don't fail the request due to email issue
      }
    }

    // Always reply with the latest known doc
    const out = notifyDoc || finalDoc;

    return res.status(200).json({
      success: true,
      message: out.isApproved
        ? shouldSendEmail
          ? "User fully approved and notified"
          : `User fully approved (${currentApprovals}/${required})`
        : `Admin approval recorded (${currentApprovals}/${required})`,
      data: {
        id: out._id,
        name: out.name,
        email: out.email,
        role: out.role,
        isApproved: out.isApproved,
        currentApprovals: out.approvals?.approvedBy?.length || 0,
        requiredApprovals: out.approvals?.requiredApprovals || 2,
        finalizedAt: out.approvals?.finalizedAt || null,
        notifiedAt: out.approvals?.notifiedAt || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Reject/Delete a user
export const rejectUser = async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  try {
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isApproved) {
      return res.status(400).json({
        success: false,
        message: "Invalid operation",
      });
    }

    const userEmail = user.email;
    const userName = user.name;

    await userModel.findByIdAndDelete(userId);

    // Send rejection notification email to user
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        to: userEmail,
        from: process.env.SMTP_USER,
        subject: "Account Application Status for RRISPAT",
        html: `!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Account Application Declined</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hello ${userName},</p>

        <p>We regret to inform you that your application for a <strong>transport user account</strong> has been declined.</p>

        <p>If you believe this was in error or would like more information, please contact our support team using the details below.</p>

        <br />

        <p>Best regards,</p>
        <p><strong>RR ISPAT Support Team</strong><br/>
          Email: techsupport@rrispat.com<br/>
          Website: <a href="https://project.rrispat.in">rrispat.com</a>
        </p>
      </body>
    </html>`,
      });
    } catch (emailError) {
      console.error("Error sending rejection email:", emailError);
      // We don't want to fail the rejection if just the email fails
    }

    return res.status(200).json({
      success: true,
      message: "User rejected and removed successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all approved transport users
export const getApprovedTransportUsers = async (req, res) => {
  try {
    const transportUsers = await userModel
      .find({
        role: "transportUser",
        isApproved: true,
      })
      .select("-password");

    return res.status(200).json({
      success: true,
      count: transportUsers.length,
      data: transportUsers,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllTenders = async (req, res) => {
  try {
    // Step 1: Get all tenders with selectedQuotation and creator info
    const tenders = await Tender.find()
      .sort({ createdAt: -1 })
      .populate({
        path: "selectedQuotation",
        populate: {
          path: "transportUser",
          select: "name email",
        },
      })
      .populate("createdBy", "name email");

    // Step 2: Fetch all quotations for all tenders
    const tenderIds = tenders.map((t) => t._id);
    const allQuotations = await Quotation.find({ tender: { $in: tenderIds } })
      .populate("transportUser", "name email")
      .sort({ createdAt: -1 });

    // Group quotations by tender ID
    const quotationsByTender = {};
    for (const q of allQuotations) {
      const signedFiles = (q.files || []).map((file) => {
        const key = file.url?.split("/").pop();
        return {
          ...file,
          url: generateSignedUrl(key),
        };
      });

      const formattedQuotation = {
        _id: q._id,
        price: q.price,
        vehicleNumber: q.vehicleNumber,
        createdAt: q.createdAt,
        transportUser: q.transportUser,
        files: signedFiles,
      };

      const tid = q.tender.toString();
      if (!quotationsByTender[tid]) quotationsByTender[tid] = [];
      quotationsByTender[tid].push(formattedQuotation);
    }

    // Step 3: Attach quotations to each tender
    const results = tenders.map((tender) => {
      const tenderObj = tender.toObject();
      tenderObj.quotations = quotationsByTender[tender._id.toString()] || [];

      // Add signed files to selectedQuotation too
      if (tenderObj.selectedQuotation && tenderObj.selectedQuotation.files) {
        tenderObj.selectedQuotation.files =
          tenderObj.selectedQuotation.files.map((file) => {
            const key = file.url?.split("/").pop();
            return {
              ...file,
              url: generateSignedUrl(key),
            };
          });
      }

      return tenderObj;
    });

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("Error fetching tenders:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRankedBestQuotationsForAllTenders = async (req, res) => {
  try {
    const tenders = await Tender.find().sort({ createdAt: -1 });
    const tenderReports = [];

    for (const tender of tenders) {
      const quotations = await Quotation.find({ tender: tender._id }).populate(
        "transportUser",
        "name email",
      );

      const bestByTransporter = new Map();

      for (const q of quotations) {
        // 🚨 Skip if transportUser or _id is missing
        if (!q.transportUser?._id) {
          continue;
        }

        const userId = q.transportUser._id.toString();

        if (!bestByTransporter.has(userId)) {
          bestByTransporter.set(userId, q);
        } else {
          const existing = bestByTransporter.get(userId);
          if (q.price < existing.price) {
            bestByTransporter.set(userId, q);
          }
        }
      }

      const bestQuotations = Array.from(bestByTransporter.values()).sort(
        (a, b) => {
          if (a.price !== b.price) return a.price - b.price;
          return a.createdAt - b.createdAt;
        },
      );

      const rankedResults = bestQuotations.map((q, index) => ({
        _id: q._id,
        quotedPrice: q.price,
        vehicleNumber: q.vehicleNumber,
        rank: `L${index + 1}`,
        selected:
          tender.selectedQuotation?.toString() === q._id.toString()
            ? "Yes"
            : "No",
        transporterName: q.transportUser?.name || "",
        vendorEmail: q.transportUser?.email || "",
        quotationDateTime: q.createdAt,
      }));

      // Format product with subMaterial + weight/quantity
      const formattedProduct = tender.materials
        .map((m) => {
          const material = m.material || "";
          const sub = m.subMaterial ? `(${m.subMaterial})` : "";
          const qty = `${m.weight || 0}kg / ${m.quantity || 0}pcs`;
          return `${material} ${sub} - ${qty}`;
        })
        .join(", ");

      tenderReports.push({
        tenderId: tender._id,
        tenderInfo: {
          product: formattedProduct,
          projectCode: tender.projectCode || "",
          projectName: tender.projectName || "",
          purchaseOrder: tender.purchaseOrder || "",
          projectRemark: tender.projectRemark || "",
          dispatchLocation: tender.dispatchLocation,
          deliveryWindow: tender.deliveryWindow,
          closeDate: tender.closeDate,
          biddingStart: tender.biddingStart,
          biddingEnd: tender.biddingEnd,
          remarks: tender.remarks,
          totalWeight: tender.totalWeight,
          totalQuantity: tender.totalQuantity,
          maxBidAmount: tender.maxBidAmount,
          status: tender.status,
          reopenCount: tender.reopenCount,
          winnerComment: tender.winnerComment,
          finalTransporter: tender.finalTransporter,
        },
        quotations: rankedResults,
      });
    }

    res.status(200).json({
      success: true,
      count: tenderReports.length,
      data: tenderReports,
    });
  } catch (error) {
    console.error("Error generating all tender reports:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const sendVehicleDecisionEmail = async ({
  to,
  name,
  approved,
  vehicleLabel,
  adminRemark = "",
}) => {
  if (!to) return;

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const subject = approved
      ? "Vehicle Request Approved - LogiQ"
      : "Vehicle Request Rejected - LogiQ";

    const html = approved
      ? `<!DOCTYPE html>
      <html>
        <head><meta charset="UTF-8" /></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>Hello ${name || "Transporter"},</p>
          <p>Your vehicle request for <strong>${vehicleLabel}</strong> has been <strong>approved</strong>.</p>
          <p>You can now see and use this vehicle from your fleet/profile section.</p>
          ${adminRemark ? `<p><strong>Admin Remark:</strong> ${adminRemark}</p>` : ""}
          <br />
          <p>Best regards,</p>
          <p><strong>LogiQ Support Team</strong></p>
        </body>
      </html>`
            : `<!DOCTYPE html>
      <html>
        <head><meta charset="UTF-8" /></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>Hello ${name || "Transporter"},</p>
          <p>Your vehicle request for <strong>${vehicleLabel}</strong> has been <strong>rejected</strong>.</p>
          ${adminRemark ? `<p><strong>Admin Remark:</strong> ${adminRemark}</p>` : ""}
          <br />
          <p>Best regards,</p>
          <p><strong>LogiQ Support Team</strong></p>
        </body>
      </html>`;

    await transporter.sendMail({
      to,
      from: process.env.SMTP_USER,
      subject,
      html,
    });
  } catch (e) {
    console.error("sendVehicleDecisionEmail error:", e);
  }
};

export const getPendingVehicleRequests = async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Only admins can view pending vehicle requests.",
    });
  }

  try {
    const rows = await TransporterVehicle.find({
      source: "custom",
      status: "pending",
    })
      .populate("transportUser", "name email phone gstn transportId")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("getPendingVehicleRequests error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch vehicle requests.",
    });
  }
};

export const approveVehicleRequest = async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Only admins can approve vehicle requests.",
    });
  }

  try {
    const { id } = req.params;
    const {
      addToCatalog = true,
      sortOrder = 0,
      adminRemark = "",
    } = req.body || {};

    const row = await TransporterVehicle.findById(id).populate(
      "transportUser",
      "name email",
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Vehicle request not found.",
      });
    }

    if (row.status === "approved") {
      return res.status(200).json({
        success: true,
        message: "Vehicle request already approved.",
        data: row,
      });
    }

    let catalogRow = null;

    if (addToCatalog) {
      catalogRow = await VehicleCatalog.findOne({
        category: row.category,
        subCategory: row.subCategory,
      });

      if (!catalogRow) {
        try {
          catalogRow = await VehicleCatalog.create({
            group: row.group || "",
            category: row.category,
            subCategory: row.subCategory,
            isActive: true,
            sortOrder: Number(sortOrder) || 0,
          });
        } catch (e) {
          if (e?.code === 11000) {
            catalogRow = await VehicleCatalog.findOne({
              category: row.category,
              subCategory: row.subCategory,
            });
          } else {
            throw e;
          }
        }
      }
    }

    row.status = "approved";
    row.adminRemark = String(adminRemark || "").trim();
    row.approvedBy = req.user.id;
    row.approvedAt = new Date();
    row.rejectedAt = null;

    if (catalogRow?._id) {
      row.catalogVehicleId = catalogRow._id;
    }

    await row.save();

    await sendVehicleDecisionEmail({
      to: row.transportUser?.email,
      name: row.transportUser?.name,
      approved: true,
      vehicleLabel: `${row.category} - ${row.subCategory}`,
      adminRemark: row.adminRemark,
    });

    return res.status(200).json({
      success: true,
      message: addToCatalog
        ? "Vehicle request approved and added to catalog."
        : "Vehicle request approved.",
      data: row,
    });
  } catch (err) {
    console.error("approveVehicleRequest error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to approve vehicle request.",
    });
  }
};

export const rejectVehicleRequest = async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Only admins can reject vehicle requests.",
    });
  }

  try {
    const { id } = req.params;
    const { adminRemark = "" } = req.body || {};

    const row = await TransporterVehicle.findById(id).populate(
      "transportUser",
      "name email",
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Vehicle request not found.",
      });
    }

    row.status = "rejected";
    row.adminRemark = String(adminRemark || "").trim();
    row.rejectedAt = new Date();
    row.approvedAt = null;
    row.approvedBy = null;

    await row.save();

    await sendVehicleDecisionEmail({
      to: row.transportUser?.email,
      name: row.transportUser?.name,
      approved: false,
      vehicleLabel: `${row.category} - ${row.subCategory}`,
      adminRemark: row.adminRemark,
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle request rejected.",
      data: row,
    });
  } catch (err) {
    console.error("rejectVehicleRequest error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to reject vehicle request.",
    });
  }
};

export const getEligibleTransportUsers = async (req, res) => {
  try {
    if (!["user", "admin"].includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: "Only RR users/admins can fetch eligible transporters.",
      });
    }

    const rawReqs = Array.isArray(req.body?.vehicleRequirements)
      ? req.body.vehicleRequirements
      : [];

    const requirements = rawReqs
      .map((r) => ({
        vehicleId: r?.vehicleId ? String(r.vehicleId) : "",
        category: String(r?.category || "").trim(),
        subCategory: String(r?.subCategory || "").trim(),
        quantity: Math.max(1, parseInt(r?.quantity, 10) || 1),
      }))
      .filter((r) => r.vehicleId || (r.category && r.subCategory));

    const transportUsers = await userModel
      .find({
        role: "transportUser",
        isApproved: true,
      })
      .select("name email phone gstn transportId createdAt updatedAt")
      .lean();

    if (requirements.length === 0) {
      return res.status(200).json({
        success: true,
        count: transportUsers.length,
        data: transportUsers.map((u) => ({
          ...u,
          eligible: true,
          defaultSelected: true,
          matchType: "no-requirement",
          matchedCount: 0,
          requiredCount: 0,
          summary: "No vehicle requirement selected",
          matchedVehicles: [],
          missingVehicles: [],
        })),
      });
    }

    const transporterIds = transportUsers.map((u) => u._id);

    const fleetRows = await TransporterVehicle.find({
      transportUser: { $in: transporterIds },
      status: "approved",
    }).lean();

    const fleetMap = new Map();

    const makeKey = (category, subCategory) =>
      `${String(category || "")
        .trim()
        .toLowerCase()}__${String(subCategory || "")
        .trim()
        .toLowerCase()}`;

    for (const row of fleetRows) {
      const uid = String(row.transportUser);
      if (!fleetMap.has(uid)) {
        fleetMap.set(uid, {
          byVehicleId: new Map(),
          byLabel: new Map(),
        });
      }

      const bucket = fleetMap.get(uid);

      if (row.catalogVehicleId) {
        const key = String(row.catalogVehicleId);
        bucket.byVehicleId.set(
          key,
          (bucket.byVehicleId.get(key) || 0) + Number(row.quantityOwned || 0),
        );
      }

      const labelKey = makeKey(row.category, row.subCategory);
      bucket.byLabel.set(
        labelKey,
        (bucket.byLabel.get(labelKey) || 0) + Number(row.quantityOwned || 0),
      );
    }

    const results = transportUsers.map((u) => {
      const uid = String(u._id);
      const fleet = fleetMap.get(uid) || {
        byVehicleId: new Map(),
        byLabel: new Map(),
      };

      const matchedVehicles = [];
      const missingVehicles = [];

      for (const reqItem of requirements) {
        const labelKey = makeKey(reqItem.category, reqItem.subCategory);

        let ownedQty = 0;

        if (reqItem.vehicleId && fleet.byVehicleId.has(reqItem.vehicleId)) {
          ownedQty = fleet.byVehicleId.get(reqItem.vehicleId) || 0;
        } else {
          ownedQty = fleet.byLabel.get(labelKey) || 0;
        }

        if (ownedQty >= reqItem.quantity) {
          matchedVehicles.push({
            vehicleId: reqItem.vehicleId || null,
            category: reqItem.category,
            subCategory: reqItem.subCategory,
            ownedQty,
            requiredQty: reqItem.quantity,
          });
        } else {
          missingVehicles.push({
            vehicleId: reqItem.vehicleId || null,
            category: reqItem.category,
            subCategory: reqItem.subCategory,
            ownedQty,
            requiredQty: reqItem.quantity,
          });
        }
      }

      const matchedCount = matchedVehicles.length;
      const requiredCount = requirements.length;
      const eligible = missingVehicles.length === 0;
      const defaultSelected = eligible;

      let matchType = "none";
      let summary = "No matching vehicle";

      if (eligible) {
        matchType = "full";
        summary = "Has all required vehicles";
      } else if (matchedCount > 0) {
        matchType = "partial";
        summary = `Missing ${missingVehicles.map((x) => x.subCategory).join(", ")}`;
      }

      return {
        ...u,
        eligible,
        defaultSelected,
        matchType,
        matchedCount,
        requiredCount,
        summary,
        matchedVehicles,
        missingVehicles,
      };
    });

    results.sort((a, b) => {
      const rank = { full: 0, partial: 1, none: 2, "no-requirement": 3 };
      const ra = rank[a.matchType] ?? 99;
      const rb = rank[b.matchType] ?? 99;
      if (ra !== rb) return ra - rb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (err) {
    console.error("getEligibleTransportUsers error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch eligible transport users.",
    });
  }
};
