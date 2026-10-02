import express from "express"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import { RoyaltyPool, RoyaltyDistribution } from "../models/RoyaltyPool.js"
import User from "../models/User.js"
import PPCSettings from "../models/PPCSettings.js"
import Commission from "../commission/commission.model.js"

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

    // Accurately sync total company PPC from actual company distributor commissions
    const distComms = await Commission.aggregate([
      { $match: { positionType: "distributor" } },
      { $group: { _id: null, totalPPC: { $sum: "$ppcCount" } } }
    ])
    const totalPPC = distComms[0]?.totalPPC ?? (pool.currentCycle.totalCompanyPPC || 0)
    pool.currentCycle.totalCompanyPPC = totalPPC
    const rsPerPPC = pool.poolMultiplier ?? 10
    const poolRupees = totalPPC * rsPerPPC
    const poolPPC = rate > 0 ? (poolRupees / rate) : 0
    const distCount = distributors.length || 1
    const shareRupees = poolRupees / distCount
    const sharePPC = poolPPC / distCount

    // Keep pool in sync
    if (pool.currentCycle.accumulatedPoolRupees !== poolRupees || pool.currentCycle.accumulatedPoolPPC !== poolPPC) {
      pool.currentCycle.accumulatedPoolRupees = poolRupees
      pool.currentCycle.accumulatedPoolPPC = poolPPC
      await pool.save()
    }

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
      poolMultiplier: rsPerPPC,
      poolPercentage: pool.poolPercentage,
      cyclePeriod: pool.cyclePeriod,
      isActive: pool.isActive,
      ppcRate: rate,
      currentCycle: {
        startDate: pool.currentCycle.startDate,
        totalCompanyPPC: totalPPC,
        totalCompanySalesRupees: pool.currentCycle.totalCompanySalesRupees,
        accumulatedPoolPPC: Math.round(poolPPC * 100) / 100,
        accumulatedPoolRupees: poolRupees,
        eligibleDistributorsCount: distributors.length,
        projectedSharePerDistributorPPC: Math.round(sharePPC * 100) / 100,
        projectedSharePerDistributorRupees: Math.round(shareRupees * 100) / 100
      },
      distributors: req.user.role === "admin" ? distributors : undefined,
      myHistory,
      myRoyaltyWallet: req.user.role === "distributor" ? ((await User.findById(req.user.id).select("royaltyWallet"))?.royaltyWallet || 0) : 0
    })
  } catch (err) {
    console.error("Royalty status error:", err)
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── Core Disbursement Logic (Shared by Admin Manual & Auto-Scheduler) ── */
export const executeRoyaltyDisbursement = async ({ disbursedBy = null }) => {
  const pool = await RoyaltyPool.getPool()
  const settings = await PPCSettings.getSettings()
  const rate = settings.basePPCValue || 40

  const distributors = await User.find({ role: "distributor", isDeleted: { $ne: true }, isBlocked: { $ne: true } })
  if (!distributors.length) {
    throw new Error("No active distributors found to disburse royalty.")
  }

  const distComms = await Commission.aggregate([
    { $match: { positionType: "distributor" } },
    { $group: { _id: null, totalPPC: { $sum: "$ppcCount" } } }
  ])
  const totalPPC = distComms[0]?.totalPPC ?? (pool.currentCycle.totalCompanyPPC || 0)
  pool.currentCycle.totalCompanyPPC = totalPPC
  const rsPerPPC = pool.poolMultiplier ?? 10
  const poolRupees = totalPPC * rsPerPPC

  if (poolRupees <= 0) {
    throw new Error("Accumulated royalty pool is zero. No turnover to distribute yet.")
  }

  const shareRupees = Math.round((poolRupees / distributors.length) * 100) / 100

  const now = new Date()
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  const periodName = `${monthNames[now.getMonth()]} ${now.getFullYear()} Royalty Cycle`

  const recipients = []

  for (const dist of distributors) {
    // ⭐ DIRECT RUPEE WALLET CREDIT — NO PPC CONVERSION, ZERO PPC ADDED!
    dist.royaltyWallet = (dist.royaltyWallet || 0) + shareRupees
    dist.totalRoyaltyEarned = (dist.totalRoyaltyEarned || 0) + shareRupees
    await dist.save()

    recipients.push({
      distributorId: dist._id,
      distributorName: dist.name,
      distributorFullName: dist.fullName || dist.name,
      amountPPC: 0,
      amountRupees: shareRupees,
      paidAt: now
    })
  }

  const distRecord = await RoyaltyDistribution.create({
    periodName,
    startDate: pool.currentCycle.startDate || new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: now,
    totalCompanyPPC: totalPPC,
    poolPercentage: pool.poolPercentage,
    totalPoolAmountPPC: 0,
    totalPoolAmountRupees: Math.round(poolRupees * 100) / 100,
    eligibleDistributorsCount: distributors.length,
    payoutPerDistributorPPC: 0,
    payoutPerDistributorRupees: shareRupees,
    disbursedBy,
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

  return { distRecord, poolRupees, distributorsCount: distributors.length }
}

/* ── Check & Auto Disburse on Schedule (Monthly Payout Day) ── */
export const checkAndAutoDisburseRoyalty = async () => {
  try {
    const settings = await PPCSettings.getSettings()
    const pool = await RoyaltyPool.getPool()
    if (!pool || !pool.isActive) return

    const now = new Date()
    const payoutDay = settings.salaryPayoutDay || 1 // default 1st of month

    if (now.getDate() !== payoutDay) return

    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    if (pool.lastDistributedAt) {
      const lastDist = new Date(pool.lastDistributedAt)
      const lastMonthStr = `${lastDist.getFullYear()}-${String(lastDist.getMonth() + 1).padStart(2, "0")}`
      if (lastMonthStr === currentMonthStr) {
        return // Already disbursed this month
      }
    }

    console.log(`🤖 [AUTO-DISBURSE] Today is payout day (${now.toDateString()}). Auto-disbursing Royalty Pool...`)
    const result = await executeRoyaltyDisbursement({ disbursedBy: null })
    console.log(`✅ [AUTO-DISBURSE] Distributed ₹${result.poolRupees} to ${result.distributorsCount} distributors!`)
  } catch (e) {
    console.error("Auto disburse royalty error:", e.message)
  }
}

/* ── PUT /api/royalty/settings — Admin updates pool % & cycle ── */
router.put("/settings", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { poolMultiplier, poolPercentage, cyclePeriod, isActive } = req.body
    const pool = await RoyaltyPool.getPool()
    const settings = await PPCSettings.getSettings()
    const rate = settings.basePPCValue || 40

    if (poolMultiplier !== undefined) pool.poolMultiplier = Math.max(1, Number(poolMultiplier))
    if (poolPercentage !== undefined) pool.poolPercentage = Math.max(0, Math.min(100, Number(poolPercentage)))
    if (cyclePeriod) pool.cyclePeriod = cyclePeriod
    if (isActive !== undefined) pool.isActive = Boolean(isActive)

    const rsPerPPC = pool.poolMultiplier ?? 10
    pool.currentCycle.accumulatedPoolRupees = (pool.currentCycle.totalCompanyPPC || 0) * rsPerPPC
    pool.currentCycle.accumulatedPoolPPC = rate > 0 ? (pool.currentCycle.accumulatedPoolRupees / rate) : 0

    await pool.save()
    res.json({ success: true, pool })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── POST /api/royalty/disburse — Admin triggers monthly payout to all Distributors ── */
router.post("/disburse", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { distRecord, poolRupees, distributorsCount } = await executeRoyaltyDisbursement({ disbursedBy: req.user.id })

    res.json({
      success: true,
      message: `🎉 Successfully distributed ₹${Math.round(poolRupees).toLocaleString("en-IN")} direct cash equally to ${distributorsCount} distributors!`,
      distribution: distRecord
    })
  } catch (err) {
    console.error("Disburse error:", err)
    res.status(400).json({ success: false, message: err.message })
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
