import mongoose from "mongoose"

const salaryPayoutSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    userRole: {
      type: String,
      default: "distributor"
    },
    walletType: {
      type: String,
      default: "sellerWallet" // distributor's wallet
    },
    level: {
      type: Number,
      required: true
    },
    levelName: {
      type: String,
      default: ""
    },
    rewardText: {
      type: String,
      default: ""
    },
    salaryAmount: {
      type: Number,
      required: true
    },
    // e.g. "2026-09"
    month: {
      type: String,
      required: true,
      index: true
    },
    creditedAt: {
      type: Date,
      default: Date.now
    },
    creditedBy: {
      type: String,
      default: "system_cron" // "system_cron" | "admin_manual"
    }
  },
  { timestamps: true }
)

// Ek user ko ek level ki salary ek month me sirf ek hi baar mil sakti hai (anti-duplicate)
salaryPayoutSchema.index({ userId: 1, level: 1, month: 1 }, { unique: true })

export default mongoose.models.SalaryPayout || mongoose.model("SalaryPayout", salaryPayoutSchema)
