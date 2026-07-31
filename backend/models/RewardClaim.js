import mongoose from "mongoose"

/*
  =====================================================
  REWARD CLAIM MODEL
  -----------------------------------------------------
  Jab user kisi wallet (userWalletAsSeller / sellerWalletAsSeller /
  distSellerWallet / distributorWallet) ka koi level/rank complete
  karta hai, wo reward "claim" karta hai — request admin ke paas
  jaati hai. Admin payment karke "paid" mark karta hai.

  Ek user + walletType + level ka combination sirf EK BAAR
  claim ho sakta hai (unique index) — dobara claim nahi hoga.
  =====================================================
*/

const rewardClaimSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // ⭐ Kaunsa wallet ka rank complete hua
    walletType: {
      type: String,
      enum: [
        "userWalletAsSeller",     // Seller ka User Wallet
        "sellerWalletAsSeller",   // Seller ka Seller Wallet
        "distSellerWallet",       // Distributor ka Direct-Seller Wallet (dist.sellerWallet)
        "distributorWallet"      // Distributor ka main level (dist.distributorWallet)
      ],
      required: true
    },

    level: {
      type: Number,
      required: true,
      min: 1,
      max: 4
    },

    // ⭐ Snapshot — us waqt ka naam/reward text (agar admin baad mein settings change kare to purana record na bigde)
    levelName: { type: String, default: "" },
    rewardText: { type: String, default: "" },
    ppcRequired: { type: Number, default: 0 },
    ppcAtClaim: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "paid", "rejected"],
      default: "pending",
      index: true
    },

    requestedAt: { type: Date, default: Date.now },

    paidAt: { type: Date, default: null },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    rejectedAt: { type: Date, default: null },
    adminNote: { type: String, default: "" }
  },
  { timestamps: true }
)

// ⭐ Ek user ek wallet ke ek level ko sirf ek hi baar (pending/paid) claim kar sakta hai
rewardClaimSchema.index(
  { userId: 1, walletType: 1, level: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "paid"] } }
  }
)

export default mongoose.model("RewardClaim", rewardClaimSchema)
