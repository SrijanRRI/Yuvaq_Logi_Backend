import userModel from "../models/userSchema.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import emailValidator from "email-validator";
import nodemailer from "nodemailer";

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  try {
    // Find user and select password field explicitly
    const user = await userModel.findOne({ email }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found 🙅",
      });
    }

    // For transportUsers, check if they're approved
    if (
      (user.role === "transportUser" || user.role === "user") &&
      !user.isApproved
    ) {
      return res.status(403).json({
        success: false,
        message: "Your account is pending admin approval",
      });
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate token (include isApproved if needed in middleware)
    const token = user.jwtToken();

    // 🔐 Cookie options for deployment
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // true in production (HTTPS)
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // "None" allows cross-origin with credentials
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      path: "/",
    };

    // Remove password before sending user data
    const userData = user.toObject();
    delete userData.password;

    // compute subscription flags for frontend
    const sub = userData.subscription || { status: "none" };
    const isSubActive =
      sub.status === "active" &&
      sub.endsAt &&
      new Date(sub.endsAt) > new Date();

    return res
      .status(200)
      .cookie("token", token, cookieOptions)
      .json({
        success: true,
        message: "Login successful",
        data: userData,
        subscription: sub,
        subscriptionActive: isSubActive,
        subscriptionRequired: userData.role !== "admin" && !isSubActive, // today both user + transportUser
      });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + error.message,
    });
  }
};

export const signup = async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    confirmPassword,
    role,
    gstn,
    transportId,
  } = req.body;

  if (!name || !email || !phone || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Every field is required",
    });
  }

  if (!emailValidator.validate(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address 📩",
    });
  }

  // Role validation - only allow 'user' and 'transportUser'
  if (role && !["user", "transportUser"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Invalid role specified",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Password and confirm password do not match ❌",
    });
  }

  const finalRole = role || "user";

  if (finalRole === "transportUser" && !gstn) {
    return res.status(400).json({
      success: false,
      message: "GSTIN is required for transport users",
    });
  }

  if (finalRole === "transportUser" && !transportId) {
    return res.status(400).json({
      success: false,
      message: "Transport ID is required for transport users",
    });
  }

  try {
    const userInfo = new userModel({
      name,
      email,
      phone,
      password,
      role: finalRole,
      ...(finalRole === "transportUser" && gstn
        ? { gstn: gstn.trim().toUpperCase() }
        : {}),
      ...(finalRole === "transportUser" && transportId
        ? { transportId: transportId.trim().toUpperCase() }
        : {}), // schema handles regex validation
    });

    const result = await userInfo.save();

    let message = "Account created successfully.";
    if (result.role === "user" || result.role === "transportUser") {
      message =
        "Account created successfully. Please wait for admin approval before you can login.";
    }

    const sanitized = result.toObject();
    delete sanitized.password;

    return res.status(200).json({
      success: true,
      message,
      data: sanitized,
    });
  } catch (error) {
    if (error.code === 11000 && error.keyValue) {
      const field = Object.keys(error.keyValue)[0] || "field";
      return res.status(400).json({
        success: false,
        message: `An account already exists with this ${field}`,
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const logout = async (req, res, next) => {
  try {
    const cookieOption = {
      expires: new Date(),
      secure: process.env.NODE_ENV === "production", // must match login
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // must match login
      path: "/", // required to match the default path
      httpOnly: true,
    };

    res.cookie("token", null, cookieOption);
    res.status(200).json({
      success: true,
      message: "Logged Out",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUser = async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await userModel.findById(userId);
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const forgotPassword = async (req, res, next) => {
  const email = req.body.email;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    const user = await userModel.findOne({
      email,
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "user not found 🙅",
      });
    }

    const forgotPasswordToken = user.getForgotPasswordToken();
    console.log(forgotPasswordToken);

    await userModel.updateOne(
      { _id: user._id },
      {
        forgotPasswordToken: user.forgotPasswordToken,
        forgotPasswordExpiryDate: user.forgotPasswordExpiryDate,
      },
    );

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${forgotPasswordToken}`;

    // Send password reset email
    await transporter.sendMail({
      to: email,
      from: process.env.SMTP_USER,
      subject: "Password Reset Request",
      html: `<p>You requested a password reset</p>
               <p>Click this <a href="${resetUrl}">link</a> to reset your password. The link will expire in 1 hour.</p>`,
    });

    return res.status(200).json({
      success: true,
      message: "Password reset link is successfully send to your mail id",
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const resetPassword = async (req, res, next) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (!password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "password and confirmPassword is required",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "password and confirm Password does not match ❌",
    });
  }

  const hashToken = crypto.createHash("sha256").update(token).digest("hex");

  try {
    const user = await userModel.findOne({
      forgotPasswordToken: hashToken,
      forgotPasswordExpiryDate: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid Token or token is expired",
      });
    }

    // Manually hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset fields
    await userModel.updateOne(
      { _id: user._id },
      {
        password: hashedPassword,
        forgotPasswordToken: undefined,
        forgotPasswordExpiryDate: undefined,
      },
    );

    return res.status(200).json({
      success: true,
      message: "Successfully reset the password",
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
export const getAllUsers = async (req, res) => {
  try {
    const users = await userModel
      .find({ isApproved: "true" })
      .select("-password"); // Exclude passwords

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve users: " + error.message,
    });
  }
};
//get current user
export const getCurrentUser = async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const sub = user.subscription || { status: "none" };
    const subscriptionActive =
      sub.status === "active" &&
      sub.endsAt &&
      new Date(sub.endsAt) > new Date();

    return res.status(200).json({
      success: true,
      data: user,
      role: user.role,
      subscription: sub,
      subscriptionActive,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getMyProfile = async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const sub = user.subscription || {};
    const approvals = sub.approvals || {};
    const approvedBy = Array.isArray(approvals.approvedBy)
      ? approvals.approvedBy
      : [];
    const requiredApprovals = Number(approvals.requiredApprovals || 0);
    const approvedCount = approvedBy.length;
    const pendingApprovals = Math.max(requiredApprovals - approvedCount, 0);

    const subscriptionActive =
      sub.status === "active" &&
      sub.endsAt &&
      new Date(sub.endsAt) > new Date();

    return res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        role: user.role || "",
        isApproved: !!user.isApproved,
        notificationId: user.notificationId || "",
        gstn: user.gstn || "",
        transportId: user.transportId || "",
        createdAt: user.createdAt || null,
        updatedAt: user.updatedAt || null,

        subscription: {
          status: sub.status || "none",
          plan: sub.plan || "",
          startAt: sub.startAt || null,
          endsAt: sub.endsAt || null,
          lastPaymentId: sub.lastPaymentId || "",
          updatedAt: sub.updatedAt || null,
          isApproved: !!sub.isApproved,
          isActive: subscriptionActive,

          approvals: {
            requiredApprovals,
            approvedCount,
            pendingApprovals,
            approvedBy,
            finalizedAt: approvals.finalizedAt || null,
          },
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch profile",
    });
  }
};
