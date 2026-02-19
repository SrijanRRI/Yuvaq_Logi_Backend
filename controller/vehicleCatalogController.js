// controllers/vehicleCatalogController.js
import VehicleCatalog from "../models/vehicleCatalogSchema.js";

export const getVehicleCatalog = async (req, res) => {
  try {
    const rows = await VehicleCatalog.find({ isActive: true })
      .select("group category subCategory sortOrder") // _id comes by default
      .sort({ category: 1, sortOrder: 1, subCategory: 1 })
      .lean();

    const grouped = rows.reduce((acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push({
        _id: r._id,
        subCategory: r.subCategory,
        group: r.group || "",
        sortOrder: r.sortOrder ?? 0,
      });
      return acc;
    }, {});

    return res.json({ success: true, data: grouped });
  } catch (err) {
    console.error("getVehicleCatalog error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};