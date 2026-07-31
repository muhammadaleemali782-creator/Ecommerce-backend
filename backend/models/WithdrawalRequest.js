import mongoose from "mongoose"

/*
  =====================================================
  WITHDRAWAL REQUEST MODEL
  -----------------------------------------------------
  Tracks all PPC withdrawal requests
  ✔ User requests withdrawal
  ✔ Admin approves/rejects
  ✔ Complete history tracking
  =====================================================
*/

const withdrawalRequestSchema = new mongoose.Schema(
  {
    /* ================= USER INFO ================= */
    
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    userRole: {
      type: String,
      enum: ["distributor", "seller"],
      required: true
    },

    /* ================= WALLET INFO ================= */
    
    // Which wallet is being withdrawn from
    walletType: {
      type: String,
      enum: [
        "distributorWallet",
        "sellerWallet",
        "sellerWalletAsSeller",
        "userWallet",
        "userWalletAsSeller"
      ],
      required: true,
      index: true
    },

    // Amount requested
    amount: {
      type: Number,
      required: true,
      min: 0
    },

    // Balance at time of request
    balanceAtRequest: {
      type: Number,
      required: true
    },

    // ⭐ PPC Rate locked at time of request (1 PPC = ₹X)
    ppcRateAtRequest: {
      type: Number,
      default: 0
    },

    // ⭐ User's share percentage locked at time of request (25% or 50%)
    percentageAtRequest: {
      type: Number,
      default: 25
    },

    // ⭐ Final rupee value calculated at time of request
    rupeeValueAtRequest: {
      type: Number,
      default: 0
    },

    /* ================= STATUS ================= */
    
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },

    /* ================= ADMIN ACTION ================= */
    
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    approvedAt: {
      type: Date,
      default: null
    },

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    rejectedAt: {
      type: Date,
      default: null
    },

    // Admin's note/reason
    adminNote: {
      type: String,
      trim: true,
      default: ""
    },

    /* ================= PAYMENT INFO ================= */
    
    // User's payment details (bank account, UPI, etc.)
    paymentMethod: {
      type: String,
      trim: true,
      default: ""
    },

    paymentDetails: {
      type: String,
      trim: true,
      default: ""
    },

    // Transaction ID (after payment)
    transactionId: {
      type: String,
      trim: true,
      default: ""
    }
  },
  {
    timestamps: true
  }
)

/* =====================================================
   INDEXES FOR PERFORMANCE
===================================================== */
withdrawalRequestSchema.index({ userId: 1, status: 1, createdAt: -1 })
withdrawalRequestSchema.index({ status: 1, createdAt: -1 })

/* =====================================================
   HELPER METHODS
===================================================== */

withdrawalRequestSchema.methods.approve = function (adminId, note = "", transactionId = "") {
  this.status = "approved"
  this.approvedBy = adminId
  this.approvedAt = new Date()
  this.adminNote = note
  this.transactionId = transactionId
  return this
}

withdrawalRequestSchema.methods.reject = function (adminId, reason = "") {
  this.status = "rejected"
  this.rejectedBy = adminId
  this.rejectedAt = new Date()
  this.adminNote = reason
  return this
}

export default mongoose.model("WithdrawalRequest", withdrawalRequestSchema)
