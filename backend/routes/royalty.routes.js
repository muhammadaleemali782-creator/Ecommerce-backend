import express from "express"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import { RoyaltyPool, RoyaltyDistribution } from "../models/RoyaltyPool.js"
import User from "../models/User.js"
import PPCSettings from "../models/PPCSettings.js"

const router = express.Router()

/* ── GET /api/royalty/settings — Admin & Distributor view settings & current pool status ── */
router.get("/status", protect, allowRoles("admin", "distributor"), async (req, res) => {
  try {
    const pool = await RoyaltyPool.getPool()
    const settings = await PPCSettings.getSettings()
    const rate = settings.basePPCValue || 40

    // Find all active distributors
    const distributors = await User.find({ role: "distributor", isDeleted: { $ne: true }, isBlocked: { $ne: true } })
      .select("name fullName email phone distributorWallet sellerWallet createdAt")

    const totalPPC = pool.currentCycle.totalCompanyPPC || 0
    const poolPPC = (totalPPC * pool.poolPercentage) / 100
    const poolRupees = poolPPC * rate
    const distCount = distributors.length || 1
    const sharePPC = poolPPC / distCount
    const shareRupees = poolRupees / distCount

    // Distributor's own past royalty history
    let myHistory = []
    if (req.user.role === "distributor") {
      const past = await RoyaltyDistribution.find({ "recipients.distributorId": req.user.id })
        .sort({ createdAt: -1 })
        .limit(24)
      myHistory = past.map(p => {
        const myRec = p.recipients.find(r => String(r.distributorId) === String(req.user.id))
        return {
          _id: p._id,
          periodName: p.periodName,
          date: p.createdAt,
          totalPoolAmountRupees: p.totalPoolAmountRupees,
          amountPPC: myRec?.amountPPC || p.payoutPerDistributorPPC,
          amountRupees: myRec?.amountRupees || p.payoutPerDistributorRupees
        }
      })
    }

    res.json({
      success: true,
      poolPercentage: pool.poolPercentage,
      cyclePeriod: pool.cyclePeriod,
      isActive: pool.isActive,
      ppcRate: rate,
      currentCycle: {
        startDate: pool.currentCycle.startDate,
        totalCompanyPPC: totalPPC,
        totalCompanySalesRupees: pool.currentCycle.totalCompanySalesRupees,
        accumulatedPoolPPC: poolPPC,
        accumulatedPoolRupees: poolRupees,
        eligibleDistributorsCount: distributors.length,
        projectedSharePerDistributorPPC: Math.round(sharePPC * 100) / 100,
        projectedSharePerDistributorRupees: Math.round(shareRupees * 100) / 100
      },
      distributors: req.user.role === "admin" ? distributors : undefined,
      myHistory
    })
  } catch (err) {
    console.error("Royalty status error:", err)
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── PUT /api/royalty/settings — Admin updates pool % & cycle ── */
router.put("/settings", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { poolPercentage, cyclePeriod, isActive } = req.body
    const pool = await RoyaltyPool.getPool()

    if (poolPercentage !== undefined) pool.poolPercentage = Math.max(0, Math.min(100, Number(poolPercentage)))
    if (cyclePeriod) pool.cyclePeriod = cyclePeriod
    if (isActive !== undefined) pool.isActive = Boolean(isActive)

    await pool.save()
    res.json({ success: true, pool })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── POST /api/royalty/disburse — Admin triggers monthly payout to all Distributors ── */
router.post("/disburse", protect, allowRoles("admin"), async (req, res) => {
  try {
    const pool = await RoyaltyPool.getPool()
    const settings = await PPCSettings.getSettings()
    const rate = settings.basePPCValue || 40

    const distributors = await User.find({ role: "distributor", isDeleted: { $ne: true }, isBlocked: { $ne: true } })
    if (!distributors.length) {
      return res.status(400).json({ success: false, message: "No active distributors found to disburse royalty." })
    }

    const totalPPC = pool.currentCycle.totalCompanyPPC || 0
    const poolPPC = (totalPPC * pool.poolPercentage) / 100
    const poolRupees = poolPPC * rate
    const sharePPC = poolPPC / distributors.length
    const shareRupees = poolRupees / distributors.length

    if (poolPPC <= 0) {
      return res.status(400).json({ success: false, message: "Accumulated royalty pool is zero. No turnover to distribute yet." })
    }

    const now = new Date()
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const periodName = `${monthNames[now.getMonth()]} ${now.getFullYear()} Royalty Cycle`

    const recipients = []

    for (const dist of distributors) {
      // Credit to distributor's sellerWallet (withdrawable commission wallet)
      dist.sellerWallet = (dist.sellerWallet || 0) + sharePPC
      dist.totalPPCEarned = (dist.totalPPCEarned || 0) + sharePPC
      await dist.save()

      recipients.push({
        distributorId: dist._id,
        distributorName: dist.name,
        distributorFullName: dist.fullName || dist.name,
        amountPPC: Math.round(sharePPC * 100) / 100,
        amountRupees: Math.round(shareRupees * 100) / 100,
        paidAt: now
      })
    }

    const distRecord = await RoyaltyDistribution.create({
      periodName,
      startDate: pool.currentCycle.startDate || new Date(now.getFullYear(), now.getMonth(), 1),
      endDate: now,
      totalCompanyPPC: totalPPC,
      poolPercentage: pool.poolPercentage,
      totalPoolAmountPPC: Math.round(poolPPC * 100) / 100,
      totalPoolAmountRupees: Math.round(poolRupees * 100) / 100,
      eligibleDistributorsCount: distributors.length,
      payoutPerDistributorPPC: Math.round(sharePPC * 100) / 100,
      payoutPerDistributorRupees: Math.round(shareRupees * 100) / 100,
      disbursedBy: req.user.id,
      recipients
    })

    // Reset current cycle accumulator
    pool.currentCycle = {
      startDate: now,
      totalCompanyPPC: 0,
      totalCompanySalesRupees: 0,
      accumulatedPoolPPC: 0,
      accumulatedPoolRupees: 0
    }
    pool.lastDistributedAt = now
    await pool.save()

    res.json({
      success: true,
      message: `🎉 Successfully distributed ₹${Math.round(poolRupees).toLocaleString("en-IN")} (${Math.round(poolPPC)} PPC) equally to ${distributors.length} distributors!`,
      distribution: distRecord
    })
  } catch (err) {
    console.error("Disburse error:", err)
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── GET /api/royalty/history — Distribution logs ── */
router.get("/history", protect, allowRoles("admin", "distributor"), async (req, res) => {
  try {
    const history = await RoyaltyDistribution.find()
      .sort({ createdAt: -1 })
      .limit(50)
    res.json({ success: true, history })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
