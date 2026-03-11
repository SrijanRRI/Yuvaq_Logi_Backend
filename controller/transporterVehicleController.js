import TransporterVehicle from "../models/transporterVehicleSchema.js";
import VehicleCatalog from "../models/vehicleCatalogSchema.js";

const clean = (v = "") => String(v ?? "").trim();

const toPositiveInt = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
};

const requireTransportUser = (req, res) => {
  if (req.user?.role !== "transportUser") {
    res.status(403).json({
      success: false,
      message: "Only transport users can manage fleet.",
    });
    return false;
  }
  return true;
};

export const getMyFleet = async (req, res) => {
  if (!requireTransportUser(req, res)) return;

  try {
    const rows = await TransporterVehicle.find({
      transportUser: req.user.id,
    })
      .populate("catalogVehicleId", "group category subCategory isActive sortOrder")
      .sort({ status: 1, category: 1, subCategory: 1, createdAt: -1 })
      .lean();

    const summary = {
      approved: rows.filter((x) => x.status === "approved").length,
      pending: rows.filter((x) => x.status === "pending").length,
      rejected: rows.filter((x) => x.status === "rejected").length,
    };

    return res.status(200).json({
      success: true,
      count: rows.length,
      summary,
      data: rows,
    });
  } catch (err) {
    console.error("getMyFleet error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch transporter fleet.",
    });
  }
};

export const addCatalogVehicleToMyFleet = async (req, res) => {
  if (!requireTransportUser(req, res)) return;

  try {
    const { catalogVehicleId, quantityOwned } = req.body;

    if (!catalogVehicleId) {
      return res.status(400).json({
        success: false,
        message: "catalogVehicleId is required.",
      });
    }

    const qty = toPositiveInt(quantityOwned, 1);

    const catalog = await VehicleCatalog.findOne({
      _id: catalogVehicleId,
      isActive: true,
    }).lean();

    if (!catalog) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found in catalog.",
      });
    }

    let existing = await TransporterVehicle.findOne({
      transportUser: req.user.id,
      $or: [
        { catalogVehicleId: catalog._id },
        {
          category: catalog.category,
          subCategory: catalog.subCategory,
        },
      ],
    });

    if (existing) {
      existing.catalogVehicleId = catalog._id;
      existing.group = catalog.group || "";
      existing.category = catalog.category;
      existing.subCategory = catalog.subCategory;
      existing.quantityOwned = qty;
      existing.source = "catalog";
      existing.status = "approved";
      existing.requestedByTransporter = true;
      existing.adminRemark = "";
      existing.approvedAt = existing.approvedAt || new Date();
      existing.rejectedAt = null;
      await existing.save();

      return res.status(200).json({
        success: true,
        message: "Vehicle updated in your fleet.",
        data: existing,
      });
    }

    const created = await TransporterVehicle.create({
      transportUser: req.user.id,
      catalogVehicleId: catalog._id,
      group: catalog.group || "",
      category: catalog.category,
      subCategory: catalog.subCategory,
      quantityOwned: qty,
      source: "catalog",
      status: "approved",
      requestedByTransporter: true,
      approvedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle added to your fleet.",
      data: created,
    });
  } catch (err) {
    console.error("addCatalogVehicleToMyFleet error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to add vehicle to fleet.",
    });
  }
};

export const createCustomVehicleRequest = async (req, res) => {
  if (!requireTransportUser(req, res)) return;

  try {
    const category = clean(req.body.category);
    const subCategory = clean(req.body.subCategory);
    const group = clean(req.body.group);
    const qty = toPositiveInt(req.body.quantityOwned, 1);

    if (!category || !subCategory) {
      return res.status(400).json({
        success: false,
        message: "category and subCategory are required.",
      });
    }

    const catalogMatch = await VehicleCatalog.findOne({
      category,
      subCategory,
      isActive: true,
    }).lean();

    if (catalogMatch) {
      let existing = await TransporterVehicle.findOne({
        transportUser: req.user.id,
        $or: [
          { catalogVehicleId: catalogMatch._id },
          { category: catalogMatch.category, subCategory: catalogMatch.subCategory },
        ],
      });

      if (existing) {
        existing.catalogVehicleId = catalogMatch._id;
        existing.group = catalogMatch.group || "";
        existing.category = catalogMatch.category;
        existing.subCategory = catalogMatch.subCategory;
        existing.quantityOwned = qty;
        existing.source = "catalog";
        existing.status = "approved";
        existing.requestedByTransporter = true;
        existing.adminRemark = "";
        existing.approvedAt = existing.approvedAt || new Date();
        existing.rejectedAt = null;
        await existing.save();

        return res.status(200).json({
          success: true,
          message: "Vehicle already exists in catalog and has been added to your fleet.",
          data: existing,
        });
      }

      const createdFromCatalog = await TransporterVehicle.create({
        transportUser: req.user.id,
        catalogVehicleId: catalogMatch._id,
        group: catalogMatch.group || "",
        category: catalogMatch.category,
        subCategory: catalogMatch.subCategory,
        quantityOwned: qty,
        source: "catalog",
        status: "approved",
        requestedByTransporter: true,
        approvedAt: new Date(),
      });

      return res.status(201).json({
        success: true,
        message: "Vehicle already exists in catalog and has been added to your fleet.",
        data: createdFromCatalog,
      });
    }

    let existingCustom = await TransporterVehicle.findOne({
      transportUser: req.user.id,
      category,
      subCategory,
      source: "custom",
    });

    if (existingCustom) {
      if (existingCustom.status === "pending") {
        return res.status(409).json({
          success: false,
          message: "A pending request for this vehicle already exists.",
          data: existingCustom,
        });
      }

      existingCustom.group = group;
      existingCustom.quantityOwned = qty;
      existingCustom.status = "pending";
      existingCustom.requestedByTransporter = true;
      existingCustom.adminRemark = "";
      existingCustom.approvedBy = null;
      existingCustom.approvedAt = null;
      existingCustom.rejectedAt = null;
      await existingCustom.save();

      return res.status(200).json({
        success: true,
        message: "Vehicle request resubmitted for admin approval.",
        data: existingCustom,
      });
    }

    const created = await TransporterVehicle.create({
      transportUser: req.user.id,
      catalogVehicleId: null,
      group,
      category,
      subCategory,
      quantityOwned: qty,
      source: "custom",
      status: "pending",
      requestedByTransporter: true,
    });

    return res.status(201).json({
      success: true,
      message: "Custom vehicle request submitted for admin approval.",
      data: created,
    });
  } catch (err) {
    console.error("createCustomVehicleRequest error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to submit custom vehicle request.",
    });
  }
};

export const deleteMyFleetVehicle = async (req, res) => {
  if (!requireTransportUser(req, res)) return;

  try {
    const { id } = req.params;

    const row = await TransporterVehicle.findOneAndDelete({
      _id: id,
      transportUser: req.user.id,
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Fleet vehicle not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle removed from your fleet.",
    });
  } catch (err) {
    console.error("deleteMyFleetVehicle error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to delete vehicle.",
    });
  }
};