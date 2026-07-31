import mongoose from "mongoose"

const requestSchema = new mongoose.Schema({

  /* ================= WHO REQUESTED ================= */
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // ⭐ Jiske liye request hai (behalf member) — agar select kiya ho
  requestedForId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  /* ================= REQUEST TYPE ================= */
  type: {
    type: String,
    enum: ["seller", "distributor", "user", "password-reset"],
    required: true
  },

  /* ================= REQUEST INFO ================= */
  name: {
    type: String,
    trim: true,
    default: ""
  },

  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ""
  },

  phone: {
    type: String,
    trim: true,
    default: ""
  },

  address: {
    type: String,
    trim: true,
    default: ""
  },

  /* =====================================================
     ⭐ IDENTITY VERIFICATION — Aadhar OR PAN (ek zaroor, unique)
  ===================================================== */
  idType: {
    type: String,
    enum: ["aadhar", "pan", ""],
    default: ""
  },

  idNumber: {
    type: String,
    trim: true,
    uppercase: true,
    default: ""
  },

  /* =====================================================
     ⭐ NEW FIELD FOR PASSWORD RESET CONTACT
  ===================================================== */

  whatsapp: {
    type: String,
    trim: true,
    default: ""
  },

  /* =====================================================
     ⭐ NEW PRODUCT ASSIGNMENT SUPPORT (ADD ONLY)
     Admin approve time pe products assign ho sakte
  ===================================================== */
  assignedProducts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product"
    }
  ],

  assignAllProducts: {
    type: Boolean,
    default: false
  },

  /* ================= STATUS ================= */
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
    index: true
  },

  /* =====================================================
     🔥 HISTORY + TEMP PASSWORD + CREATED USER INFO
     (NOT REMOVED – SAFE)
  ===================================================== */

  createdUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  createdUserName: {
    type: String,
    default: ""
  },

  createdUserEmail: {
    type: String,
    default: ""
  },

  tempPassword: {
    type: String,
    default: ""
  },

  approvedAt: {
    type: Date,
    default: null
  },

  rejectedAt: {
    type: Date,
    default: null
  },

  rejectedReason: {
    type: String,
    default: ""
  }

}, { timestamps: true })


/* =====================================================
   SAFE EMAIL CLEAN
===================================================== */
requestSchema.pre("save", function () {
  if (this.email) {
    this.email = this.email.trim().toLowerCase()
  }
})

export default mongoose.model("UserRequest", requestSchema)