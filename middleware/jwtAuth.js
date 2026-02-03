import JWT from "jsonwebtoken";

export const jwtAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // keep cookie support too
  const cookieToken = req.cookies?.token || null;

  const token = bearer || cookieToken;

  if (!token) {
    return res.status(401).json({ success: false, message: "NOT authorized" });
  }

  try {
    const payload = JWT.verify(token, process.env.SECRET);

    // ✅ normalize user shape for all controllers
    req.user = {
      _id: payload.id,      // ✅ use this everywhere
      id: payload.id,       // optional
      email: payload.email,
      role: payload.role,
      // isApproved: payload.isApproved, // only if you store it in token
    };

    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message });
  }
};

// If you really need this, fetch from DB or ensure token includes isApproved.
// Right now your jwtAuth never sets req.user.isApproved, so this will always fail.
export const isApproved = (req, res, next) => {
  if (req.user?.isApproved === false) {
    return res.status(403).json({
      success: false,
      message: "Your account is pending approval from admin",
    });
  }
  next();
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied: Admin privileges required",
    });
  }
  next();
};

export default jwtAuth;
