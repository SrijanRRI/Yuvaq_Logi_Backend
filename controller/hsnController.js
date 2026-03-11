import HsnMaster from "../models/hsnMasterSchema.js";

const normalizeHsn = (value = "") => String(value).replace(/\D/g, "").trim();

export const lookupHsnByCode = async (req, res) => {
  try {
    const code = normalizeHsn(req.params.code || req.query.code);

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "HSN code is required",
      });
    }

    // exact first
    let item = await HsnMaster.findOne({ codeDigits: code }).lean();

    // fallback: if user typed parent code like 2523 or 252329
    if (!item) {
      item = await HsnMaster.findOne({
        codeDigits: { $regex: `^${code}` },
      })
        .sort({ codeDigits: 1 })
        .lean();
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "HSN code not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        codeDisplay: item.codeDisplay,
        codeDigits: item.codeDigits,
        description: item.description,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const searchHsn = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit || 20), 50);

    if (!q) {
      return res.status(200).json({ success: true, data: [] });
    }

    const digits = normalizeHsn(q);

    const filter = digits
      ? { codeDigits: { $regex: `^${digits}` } }
      : { $text: { $search: q } };

    const items = await HsnMaster.find(filter)
      .select("codeDisplay codeDigits description")
      .limit(limit)
      .lean();

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};