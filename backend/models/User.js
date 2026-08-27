import mongoose from "mongoose"

/*
  =====================================================
  USER SCHEMA
  -----------------------------------------------------
  ✔ Supports Admin / Distributor / Seller hierarchy
  ✔ Parent-child relationship (network / tree)
  ✔ Sales + Team sales tracking
  ✔ Product assignment support
  ✔ Temporary password support 🔥
  ✔ MongoDB timestamps enabled
  ✔ Email auto-clean
  ✔ Password safe select false
  ✔ Debug friendly
  ✔ Coin Wallet + MLM Commission support 🔥
  ✔ Promotion + Account Control support ⭐
  ✔ ⭐ BLOCK + DELETE CONTROL ADDED
  ✔ ⭐ LOGIN SAFETY + INDEX SAFE
  ✔ ⭐ FUTURE ENTERPRISE READY
  =====================================================
*/

const userSchema = new mongoose.Schema(
  {
    /* ================= BASIC INFO ================= */
    name: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },

    /* ================= PROFILE DETAILS ================= */
    fullName: {
      type: String,
      trim: true,
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
      default: null,
      set: (v) => (v === "" ? null : v)
    },

    password: {
      type: String,
      required: true,
      select: false
    },

    /* ⭐ FCM push notification token — Android app har login pe update
       karta hai, isi se backend push notification bhejta hai */
    fcmToken: {
      type: String,
      default: null
    },

    /* ================= ROLE & HIERARCHY ================= */
    role: {
      type: String,
      enum: ["admin", "distributor", "seller", "user"],
      default: "seller",
      index: true
    },

    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },

    /* ================= SALES METRICS ================= */
    sales: {
      type: Number,
      default: 0,
      min: 0
    },

    teamSales: {
      type: Number,
      default: 0,
      min: 0
    },

    /* ================= PRODUCT ASSIGNMENT ================= */
    assignedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      }
    ],

    /* ================= TEMP PASSWORD SYSTEM 🔥 ================= */
    resetOtp: {
      type: String,
      default: null
    },

    resetOtpExpires: {
      type: Date,
      default: null
    },

    mustChangePassword: {
      type: Boolean,
      default: false,
      index: true
    },

    /* =====================================================
       ⭐ TEMP PASSWORD RESET SUPPORT
    ===================================================== */

    tempPasswordIssuedAt: {
      type: Date,
      default: null
    },

    resetByAdmin: {
      type: Boolean,
      default: false
    },

    /* =====================================================
       ⭐ COIN WALLET SYSTEM
    ===================================================== */
    coinBalance: {
      type: Number,
      default: 0,
      min: 0
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0
    },

    /* =====================================================
       ⭐ MLM EXTRA TRACKING
    ===================================================== */
    totalCommissionEarned: {
      type: Number,
      default: 0
    },

    totalCoinEarned: {
      type: Number,
      default: 0
    },

    /* =====================================================
       ⭐ NEW PPC WALLET SYSTEM (MULTI-WALLET)
    ===================================================== */
    
    // DISTRIBUTOR WALLETS (2 wallets)
    distributorWallet: {
      type: Number,
      default: 0,
      min: 0
      // Non-withdrawable, for promotion only
      // Earns from all downline distributors + their networks
    },

    sellerWallet: {
      type: Number,
      default: 0,
      min: 0
      // Withdrawable (admin approval required)
      // Distributor earns from directly connected sellers + their networks
    },

    // SELLER WALLETS (2 wallets)
    sellerWalletAsSeller: {
      type: Number,
      default: 0,
      min: 0
      // Withdrawable
      // Seller earns from sellers below them
    },

    userWalletAsSeller: {
      type: Number,
      default: 0,
      min: 0
      // Withdrawable
      // Seller earns from users below them
    },

    /* =====================================================
       ⭐ PPC TRACKING
    ===================================================== */
    totalPPCEarned: {
      type: Number,
      default: 0
    },

    totalWithdrawn: {
      type: Number,
      default: 0
    },


    /* =====================================================
       ⭐ PROMOTION + ACCOUNT CONTROL
    ===================================================== */

    isActive: {
      type: Boolean,
      default: true,
      index: true
    },

    promotedFrom: {
      type: String,
      default: null
    },

    promotedAt: {
      type: Date,
      default: null
    },

    blockedReason: {
      type: String,
      default: null
    },

    /* =====================================================
       ⭐ BLOCK & SECURITY LOCKOUT SYSTEM
    ===================================================== */
    isBlocked: {
      type: Boolean,
      default: false,
      index: true
    },

    failedLoginAttempts: {
      type: Number,
      default: 0
    },

    lockUntil: {
      type: Date,
      default: null
    },

    lastLoginDate: {
      type: Date,
      default: null
    },

    lastActiveDevice: {
      type: String,
      default: ""
    },

    lastLoginIP: {
      type: String,
      default: ""
    },

    isDormantLocked: {
      type: Boolean,
      default: false
    },

    blockedAt: {
      type: Date,
      default: null
    },

    /* =====================================================
       ⭐ NEW → SOFT DELETE SYSTEM
    ===================================================== */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },

    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
)

/* =====================================================
   AUTO EMAIL CLEAN (FINAL SAFE VERSION)
===================================================== */
userSchema.pre("save", function () {

  if (this.email) {
    this.email = this.email.trim().toLowerCase()
  }

  /* ⭐ SAFE BALANCE CHECK */
  if (this.coinBalance < 0) this.coinBalance = 0
  if (this.walletBalance < 0) this.walletBalance = 0
  if (this.sales < 0) this.sales = 0
  if (this.teamSales < 0) this.teamSales = 0

})

/* =====================================================
   ⭐ PASSWORD RESET HELPER
===================================================== */
userSchema.methods.setTemporaryPassword = function (hashedPassword) {

  this.password = hashedPassword
  this.mustChangePassword = true
  this.resetByAdmin = true
  this.tempPasswordIssuedAt = new Date()

  return this
}

/* =====================================================
   ⭐ PASSWORD CHANGE COMPLETE
===================================================== */
userSchema.methods.passwordChanged = function () {

  this.mustChangePassword = false
  this.resetByAdmin = false
  this.tempPasswordIssuedAt = null

  return this
}

/* =====================================================
   ⭐ PROMOTE HELPER METHOD
===================================================== */
userSchema.methods.promoteToDistributor = function () {

  if (this.role === "seller") {
    this.promotedFrom = "seller"
    this.role = "distributor"
    this.promotedAt = new Date()
  }

  return this
}

/* =====================================================
   ⭐ BLOCK USER HELPER
===================================================== */
userSchema.methods.blockUser = function (reason = "Blocked by admin") {
  this.isBlocked = true
  this.blockedReason = reason
  this.blockedAt = new Date()
  return this
}

/* =====================================================
   ⭐ UNBLOCK USER HELPER
===================================================== */
userSchema.methods.unblockUser = function () {
  this.isBlocked = false
  this.blockedReason = null
  this.blockedAt = null
  return this
}

/* =====================================================
   ⭐ SOFT DELETE HELPER
===================================================== */
userSchema.methods.softDelete = function () {
  this.isDeleted = true
  this.deletedAt = new Date()
  return this
}

/* =====================================================
   ⭐ RESTORE USER HELPER
===================================================== */
userSchema.methods.restoreUser = function () {
  this.isDeleted = false
  this.deletedAt = null
  return this
}

/* =====================================================
   ⭐ LOGIN SAFETY CHECK
===================================================== */
userSchema.methods.canLogin = function () {

  if (this.isDeleted) {
    return { allowed: false, reason: "Account deleted" }
  }

  if (this.isBlocked) {
    return { allowed: false, reason: "Account blocked" }
  }

  if (!this.isActive) {
    return { allowed: false, reason: "Account inactive" }
  }

  return { allowed: true }
}

/* =====================================================
   DEBUG HELPER
===================================================== */
userSchema.methods.safeUser = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    mustChangePassword: this.mustChangePassword,
    coinBalance: this.coinBalance,
    walletBalance: this.walletBalance,
    isActive: this.isActive,
    promotedFrom: this.promotedFrom,
    isBlocked: this.isBlocked,
    isDeleted: this.isDeleted,
    createdAt: this.createdAt
  }
}

/* =====================================================
   ⭐ INDEXES FOR PERFORMANCE
===================================================== */
userSchema.index({ role: 1, parentId: 1 })
userSchema.index({ isBlocked: 1, isDeleted: 1 })
userSchema.index({ email: 1 })
userSchema.index({ idNumber: 1 }, { unique: true, sparse: true })
userSchema.index({ mustChangePassword: 1 })

/*
  =====================================================
  MODEL EXPORT
  =====================================================
*/
export default mongoose.model("User", userSchema)