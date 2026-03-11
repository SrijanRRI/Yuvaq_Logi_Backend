import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcrypt";
import JWT from "jsonwebtoken";

const ApprovalsSchema = new mongoose.Schema(
  {
    requiredApprovals: { type: Number, default: 2, min: 1 },
    approvedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
    finalizedAt: { type: Date, default: null },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is mandatory"],
    },
    email: {
      type: String,
      required: [true, "Email is mandatory"],
      unique: [true, "already registered email"],
    },
    phone: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "admin", "transportUser"],
      default: "user",
    },
    gstn: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true, // if you want no duplicates
      sparse: true, // allows null/undefined users without gstn
      match: [/^[0-9A-Z]{15}$/, "Invalid GST Number"], // regex for GSTIN
    },
    
    transportId: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      minlength: [3, "Transport ID is too short"],
      maxlength: [30, "Transport ID is too long"],
    },
    // Final approval flag used across your app
    isApproved: {
      type: Boolean,
      default: function () {
        // Auto-approve admins; everyone else requires explicit approval(s)
        return this.role === "admin";
      },
    },

    // Tiered approval tracking (for transportUser or any role you decide)
    approvals: {
      type: ApprovalsSchema,
      default: () => ({}),
    },
    notifiedAt: { type: Date, default: null }, // <-- add this
    forgotPasswordToken: String,
    forgotPasswordExpiryDate: Date,

    subscription: {
      status: {
        type: String,
        enum: ["none", "active", "expired"],
        default: "none",
        index: true,
      },
      plan: {
        type: String,
        enum: ["monthly", "yearly"],
        default: null,
      },
      startsAt: { type: Date, default: null },
      endsAt: { type: Date, default: null, index: true },
      lastPaymentId: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// ---- Indexes ----
// Avoid duplicate approver IDs for a user (enforced by app logic, this helps performance)
userSchema.index({ _id: 1, "approvals.approvedBy": 1 });

// ---- Virtuals ----
userSchema.virtual("approvalCount").get(function () {
  return this.approvals?.approvedBy?.length || 0;
});

// ---- Methods ----
userSchema.methods = {
  jwtToken() {
    return JWT.sign(
      {
        id: this._id,
        email: this.email,
        role: this.role,
        isApproved: this.isApproved,
      },
      process.env.SECRET,
      { expiresIn: "24h" },
    );
  },

  getForgotPasswordToken() {
    const forgotToken = crypto.randomBytes(20).toString("hex");
    this.forgotPasswordToken = crypto
      .createHash("sha256")
      .update(forgotToken)
      .digest("hex");

    this.forgotPasswordExpiryDate = Date.now() + 20 * 60 * 1000;
    return forgotToken;
  },

  hasBeenApprovedBy(adminId) {
    return (this.approvals?.approvedBy || []).some(
      (id) => String(id) === String(adminId),
    );
  },
};

// ---- Hooks ----
userSchema.pre("save", async function (next) {
  // Hash password if changed
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  return next();
});

const userModel = mongoose.model("user", userSchema);
export default userModel;
