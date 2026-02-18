import Quotation from "../models/quotationSchema.js";
import Tender from "../models/tenderSchema.js";
import { s3, BUCKET_NAME } from "../utils/minioClient.js";
import { generateSignedUrl } from "../utils/minioClient.js";

export const submitQuotation = async (req, res) => {
  try {
    const { price } = req.body;

    // ✅ vehicleNumber optional now
    const vehicleNumber =
      typeof req.body.vehicleNumber === "string" &&
      req.body.vehicleNumber.trim()
        ? req.body.vehicleNumber.trim()
        : undefined;

    const userId = req.user.id;
    const tenderId = req.params.id;

    // Basic validation
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid positive price",
      });
    }

    // 1) Validate Tender
    const tender = await Tender.findById(tenderId);
    if (!tender || tender.status !== "open") {
      return res.status(400).json({
        success: false,
        message: "Tender is not open for quotation",
      });
    }

    const now = new Date();
    if (now < tender.biddingStart || now > tender.biddingEnd) {
      return res.status(403).json({
        success: false,
        message: "Bidding window is closed",
      });
    }

    // 🔹 Use tender.priceDifference (fallback to 30 if missing/invalid)
    const minDelta =
      Number.isFinite(Number(tender.priceDifference)) &&
      Number(tender.priceDifference) >= 0
        ? Number(tender.priceDifference)
        : 30;

    // =========================================================
    // ✅ UNLIMITED BIDDING ENABLED (3-bid restriction removed)
    // Previously:
    // 2) Enforce 3-bid limit per user for this tender
    //
    // const bidCount = await Quotation.countDocuments({
    //   tender: tenderId,
    //   transportUser: userId,
    //   phase: "normal",
    // });
    //
    // if (bidCount >= 3) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "You have reached the maximum of 3 bids for this tender",
    //   });
    // }
    // =========================================================

    // 3) Compute current L1 (lowest among each transporter's best price)
    const allQuotes = await Quotation.find({
      tender: tenderId,
      phase: "normal",
    }).sort({
      price: 1,
      createdAt: 1,
    });

    const bestQuotesMap = new Map(); // transportUserId => bestQuotation
    for (const q of allQuotes) {
      const uid = q.transportUser.toString();
      if (!bestQuotesMap.has(uid)) {
        bestQuotesMap.set(uid, q); // first is the lowest due to sort
      }
    }

    let L1 = null;
    for (const [, q] of bestQuotesMap.entries()) {
      if (
        !L1 ||
        q.price < L1.price ||
        (q.price === L1.price && q.createdAt < L1.createdAt)
      ) {
        L1 = q;
      }
    }

    // 4) Rule: if new price is below L1, it must beat L1 by at least tender.priceDifference
    if (L1 && numericPrice < L1.price) {
      const diff = L1.price - numericPrice;
      if (diff < minDelta) {
        return res.status(400).json({
          success: false,
          message: `Given quoted price difference must be ${minDelta}`,
          data: {
            currentL1: {
              quotationId: L1._id,
              transportUser: L1.transportUser,
              createdAt: L1.createdAt,
              vehicleNumber: L1.vehicleNumber,
            },
            yourPrice: numericPrice,
            difference: diff,
            minimumRequiredDifference: minDelta,
          },
        });
      }
    }

    // 5) Upload file (if provided)
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

    // 6) Save Quotation
    const quotation = new Quotation({
      tender: tender._id,
      transportUser: userId,
      price: numericPrice,
      // ✅ will be undefined if not provided (allowed now)
      vehicleNumber,
      files: uploadedFiles,
    });
    await quotation.save();

    // 7) Link quotation to tender
    tender.quotations.push(quotation._id);
    await tender.save();

    return res.status(201).json({
      success: true,
      message: "Quotation submitted successfully.",
      data: {
        quotation,
        validationSnapshot: L1
          ? {
              yourPrice: numericPrice,
              wasBelowL1: numericPrice < L1.price,
              requiredMinDeltaIfBelowL1: minDelta,
            }
          : {
              currentL1PriceBeforeSubmit: null,
              yourPrice: numericPrice,
              wasBelowL1: false,
              requiredMinDeltaIfBelowL1: minDelta,
            },
      },
    });
  } catch (error) {
    console.error("Quotation submission error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong: " + error.message,
    });
  }
};

//get all quotations for a tender

export const getMyQuotationsForTender = async (req, res) => {
  try {
    const tenderId = req.params.tenderId;
    const transportUserId = req.user.id;

    if (!tenderId) {
      return res
        .status(400)
        .json({ success: false, message: "Tender ID is required" });
    }

    // Get all quotations submitted by this transporter for this tender
    const myQuotes = await Quotation.find({
      tender: tenderId,
      transportUser: transportUserId,
    }).sort({ createdAt: 1 });

    // Attach signed file URLs
    const formatted = myQuotes.map((q) => {
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

    res.status(200).json({ success: true, quotations: formatted });
  } catch (error) {
    console.error("Error fetching transporter quotations:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
