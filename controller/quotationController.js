import Quotation from "../models/quotationSchema.js";
import Tender from "../models/tenderSchema.js";
import { s3, BUCKET_NAME } from "../utils/minioClient.js";
import { generateSignedUrl } from "../utils/minioClient.js";

const MAX_NORMAL_BIDS_PER_TENDER = 5;

export const submitQuotation = async (req, res) => {
  try {
    const { price } = req.body;

    const vehicleNumber =
      typeof req.body.vehicleNumber === "string" &&
      req.body.vehicleNumber.trim()
        ? req.body.vehicleNumber.trim()
        : undefined;

    const userId = req.user.id;
    const tenderId = req.params.id;

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid positive price",
      });
    }

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

    const softEnd = tender.biddingSoftEnd || tender.biddingEnd;
    const hardEnd = tender.biddingHardEnd || tender.biddingEnd;

    const minDelta =
      Number.isFinite(Number(tender.priceDifference)) &&
      Number(tender.priceDifference) > 0
        ? Number(tender.priceDifference)
        : 25;

    const normalPhaseFilter = {
      $or: [
        { phase: "normal" },
        { phase: { $exists: false } },
        { phase: null },
      ],
    };

    // Count this transporter's normal bids for this tender
    const bidCount = await Quotation.countDocuments({
      tender: tenderId,
      transportUser: userId,
      ...normalPhaseFilter,
    });

    const isFirstBidForThisTransporter = bidCount === 0;

    if (bidCount >= MAX_NORMAL_BIDS_PER_TENDER) {
      return res.status(403).json({
        success: false,
        message:
          "You have reached the maximum limit of 5 quotations for this tender.",
        data: {
          submittedCount: bidCount,
          maxSubmissions: MAX_NORMAL_BIDS_PER_TENDER,
          remainingSubmissions: 0,
        },
      });
    }

    let L1 = null;

    /*
      ✅ Main change:
      First bid of every transporter will NOT be compared with L1.
      L1 validation starts only from second bid onwards.
    */
    if (!isFirstBidForThisTransporter) {
      // Transporter must quote lower than their own previous quote
      const prevQuote = await Quotation.findOne({
        tender: tenderId,
        transportUser: userId,
        ...normalPhaseFilter,
      })
        .sort({ createdAt: -1 })
        .select("price createdAt")
        .lean();

      if (prevQuote) {
        if (numericPrice >= Number(prevQuote.price)) {
          return res.status(400).json({
            success: false,
            message:
              "New quotation must be strictly lower than your previous quotation",
            data: {
              previousPrice: Number(prevQuote.price),
              previousCreatedAt: prevQuote.createdAt,
              yourPrice: numericPrice,
            },
          });
        }
      }

      // Calculate current L1 from each transporter's best quote
      const allQuotes = await Quotation.find({
        tender: tenderId,
        ...normalPhaseFilter,
      }).sort({
        price: 1,
        createdAt: 1,
      });

      const bestQuotesMap = new Map();

      for (const q of allQuotes) {
        const uid = q.transportUser.toString();

        if (!bestQuotesMap.has(uid)) {
          bestQuotesMap.set(uid, q);
        }
      }

      for (const [, q] of bestQuotesMap.entries()) {
        if (
          !L1 ||
          q.price < L1.price ||
          (q.price === L1.price && q.createdAt < L1.createdAt)
        ) {
          L1 = q;
        }
      }

      if (L1) {
        const currentL1Price = Number(L1.price);
        const diff = currentL1Price - numericPrice;

        if (numericPrice >= currentL1Price) {
          return res.status(400).json({
            success: false,
            message: `Your quote must be lower than current lowest quote ₹${currentL1Price.toLocaleString(
              "en-IN",
            )}. Minimum difference required is ₹${minDelta}.`,
            data: {
              currentL1: {
                quotationId: L1._id,
                transportUser: L1.transportUser,
                price: currentL1Price,
                createdAt: L1.createdAt,
                vehicleNumber: L1.vehicleNumber,
              },
              yourPrice: numericPrice,
              difference: diff,
              minimumRequiredDifference: minDelta,
            },
          });
        }

        if (diff < minDelta) {
          return res.status(400).json({
            success: false,
            message: `Your quote must be at least ₹${minDelta} lower than current lowest quote ₹${currentL1Price.toLocaleString(
              "en-IN",
            )}.`,
            data: {
              currentL1: {
                quotationId: L1._id,
                transportUser: L1.transportUser,
                price: currentL1Price,
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
    }

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

    const quotation = new Quotation({
      tender: tender._id,
      transportUser: userId,
      price: numericPrice,
      vehicleNumber,
      files: uploadedFiles,
      phase: "normal",
    });

    await quotation.save();

    await Tender.updateOne(
      { _id: tenderId },
      { $push: { quotations: quotation._id } },
    );

    const EXT_WINDOW_MIN = Number(process.env.BID_EXT_WINDOW_MINUTES || 5);
    const EXT_INC_MIN = Number(process.env.BID_EXT_INCREMENT_MINUTES || 5);

    const EXT_WINDOW_MS = EXT_WINDOW_MIN * 60 * 1000;
    const EXT_INC_MS = EXT_INC_MIN * 60 * 1000;

    const currentEnd = new Date(tender.biddingEnd);
    const currentEndMs = currentEnd.getTime();
    const hardEndMs = new Date(hardEnd).getTime();
    const nowMs = now.getTime();

    const inLastWindow =
      nowMs >= currentEndMs - EXT_WINDOW_MS && nowMs <= currentEndMs;

    if (inLastWindow && currentEndMs < hardEndMs) {
      const nextEndMs = Math.min(currentEndMs + EXT_INC_MS, hardEndMs);
      const nextEnd = new Date(nextEndMs);

      await Tender.findOneAndUpdate(
        { _id: tenderId, biddingEnd: tender.biddingEnd },
        {
          $set: { biddingEnd: nextEnd },
          $push: {
            biddingExtensions: {
              at: now,
              from: tender.biddingEnd,
              to: nextEnd,
              by: userId,
              quotation: quotation._id,
            },
          },
        },
      );
    }

    return res.status(201).json({
      success: true,
      message: "Quotation submitted successfully.",
      data: {
        quotation,
        submittedCount: bidCount + 1,
        maxSubmissions: MAX_NORMAL_BIDS_PER_TENDER,
        remainingSubmissions: Math.max(
          0,
          MAX_NORMAL_BIDS_PER_TENDER - (bidCount + 1),
        ),
        validationSnapshot: {
          isFirstBidForThisTransporter,
          yourPrice: numericPrice,
          currentL1PriceBeforeSubmit: L1 ? Number(L1.price) : null,
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
    // const myQuotes = await Quotation.find({
    //   tender: tenderId,
    //   transportUser: transportUserId,
    // }).sort({ createdAt: 1 });

    const myQuotes = await Quotation.find({
      tender: tenderId,
      transportUser: transportUserId,
      $or: [
        { phase: "normal" },
        { phase: { $exists: false } },
        { phase: null },
      ],
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
        phase: q.phase || "normal",
        createdAt: q.createdAt,
        files: signedFiles,
      };
    });

    res.status(200).json({
      success: true,
      quotations: formatted,
      submittedCount: formatted.length,
      maxSubmissions: MAX_NORMAL_BIDS_PER_TENDER,
      remainingSubmissions: Math.max(
        0,
        MAX_NORMAL_BIDS_PER_TENDER - formatted.length,
      ),
    });
  } catch (error) {
    console.error("Error fetching transporter quotations:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
