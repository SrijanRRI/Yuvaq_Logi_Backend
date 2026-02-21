import User from "../models/userSchema.js";

function parseRoles() {
  const raw = process.env.SUBSCRIPTION_PAY_ROLES || "user,transportUser";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isActive(sub) {
  if (!sub?.endsAt) return false;
  return sub.status === "active" && new Date(sub.endsAt) > new Date();
}

/**
 * Use AFTER jwtAuth.
 * Blocks only roles configured in SUBSCRIPTION_PAY_ROLES, never blocks admin.
 */
export const subscriptionGate = async (req, res, next) => {
  try {
    const role = req.user?.role;

    if (!role) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (role === "admin") return next();

    const payRoles = parseRoles();
    if (!payRoles.includes(role)) return next(); // role doesn't need subscription

    const user = await User.findById(req.user.id).select("subscription role");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (isActive(user.subscription)) return next();

    // auto mark expired
    if (user.subscription?.status === "active") {
      user.subscription.status = "expired";
      user.subscription.updatedAt = new Date();
      await user.save();
    }

    return res.status(402).json({
      success: false,
      subscriptionRequired: true,
      message: "Subscription required. Please buy monthly/yearly plan.",
      subscription: user.subscription || { status: "none" },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};