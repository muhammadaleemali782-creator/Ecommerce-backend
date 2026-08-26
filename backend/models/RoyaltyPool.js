import mongoose from "mongoose"

const royaltyPoolSchema = new mongoose.Schema(
  {
    poolPercentage: {
      type: Number,
      default: 1,
      min: 0,
      max: 100
    },
    cyclePeriod: {
      type: String,
      enum: ["monthly", "15-days", "weekly"],
      default: "monthly"
    },
    isActive: {
      type: Boolean,
      default: true
    },
    currentCycle: {
      startDate: { type: Date, default: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      totalCompanyPPC: { type: Number, default: 0 },
      totalCompanySalesRupees: { type: Number, default: 0 },
      accumulatedPoolPPC: { type: Number, default: 0 },
      accumulatedPoolRupees: { type: Number, default: 0 },
    },
    lastDistributedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

royaltyPoolSchema.statics.getPool = async function () {
  let pool = await this.findOne()
  if (!pool) {
    pool = await this.create({
      poolPercentage: 1,
      cyclePeriod: "monthly",
      isActive: true,
      currentCycle: {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        totalCompanyPPC: 0,
        totalCompanySalesRupees: 0,
        accumulatedPoolPPC: 0,
        accumulatedPoolRupees: 0
      }
    })
  }
  return pool
}

export const RoyaltyPool = mongoose.model("RoyaltyPool", royaltyPoolSchema)

const royaltyDistributionSchema = new mongoose.Schema(
  {
    periodName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalCompanyPPC: { type: Number, required: true },
    poolPercentage: { type: Number, required: true },
    totalPoolAmountPPC: { type: Number, required: true },
    totalPoolAmountRupees: { type: Number, required: true },
    eligibleDistributorsCount: { type: Number, default: 0 },
    payoutPerDistributorPPC: { type: Number, default: 0 },
    payoutPerDistributorRupees: { type: Number, default: 0 },
    disbursedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recipients: [
      {
        distributorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        distributorName: { type: String },
        distributorFullName: { type: String },
        amountPPC: { type: Number },
        amountRupees: { type: Number },
        paidAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
)

export const RoyaltyDistribution = mongoose.model("RoyaltyDistribution", royaltyDistributionSchema)
