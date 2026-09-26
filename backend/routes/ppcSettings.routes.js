import express from "express"
import auth from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import PPCSettings from "../models/PPCSettings.js"
import Commission from "../commission/commission.model.js"
import User from "../models/User.js"
import Order from "../models/Order.js"

const router = express.Router()

// Get settings
router.get("/", auth, async (req, res) => {
  try {
    const settings = await PPCSettings.getSettings()
    res.json(settings)
  } catch (err) {
    res.status(500).json({ message: "Failed to load settings" })
  }
})

// Update settings (Admin only)
router.post("/update", auth, allowRoles("admin"), async (req, res) => {
  try {
    
    const {
      basePPCValue,
      distributionRates,
      userOrderDistributionRates,
      minimumWithdrawal,
      levelUpThresholds,
      levelNames,
      levelRewards,
      // ✅ Seller Level Settings (Direct Seller Wallet)
      sellerLevelUpThresholds,
      sellerLevelNames,
      sellerLevelRewards,
      // ✅ User Wallet Level Settings (separate from Direct Seller Wallet)
      userWalletLevelUpThresholds,
      userWalletLevelNames,
      userWalletLevelRewards,
      // ✅ Distributor's OWN Direct Seller Wallet — separate from Seller's Direct Seller Wallet
      distSellerLevelUpThresholds,
      distSellerLevelNames,
      distSellerLevelRewards,
    } = req.body

    let settings = await PPCSettings.getSettings()

    if (basePPCValue !== undefined) settings.basePPCValue = Number(basePPCValue)

    if (distributionRates) {
      if (distributionRates.direct !== undefined)      settings.distributionRates.direct      = Number(distributionRates.direct)
      if (distributionRates.parent !== undefined)      settings.distributionRates.parent      = Number(distributionRates.parent)
      if (distributionRates.distributor !== undefined) settings.distributionRates.distributor = Number(distributionRates.distributor)
    }

    // ⭐ NEW: User-order split (jab "user" role khud sale kare — no seller involved)
    if (userOrderDistributionRates) {
      if (!settings.userOrderDistributionRates) settings.userOrderDistributionRates = {}
      if (userOrderDistributionRates.directSeller !== undefined)
        settings.userOrderDistributionRates.directSeller = Number(userOrderDistributionRates.directSeller)
      if (userOrderDistributionRates.distributor !== undefined)
        settings.userOrderDistributionRates.distributor = Number(userOrderDistributionRates.distributor)
    }

    if (minimumWithdrawal !== undefined) settings.minimumWithdrawal = Number(minimumWithdrawal)

    if (req.body.googleSheetWebhookUrl !== undefined) {
      settings.googleSheetWebhookUrl = String(req.body.googleSheetWebhookUrl || "").trim()
    }

    // ⭐ Monthly Lifetime Salary Payout Date (1 to 28)
    if (req.body.salaryPayoutDay !== undefined) {
      const day = parseInt(req.body.salaryPayoutDay)
      if (day >= 1 && day <= 28) {
        settings.salaryPayoutDay = day
      }
    }

    // ✅ Dynamic Distributor Level Thresholds
    if (levelUpThresholds && typeof levelUpThresholds === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(levelUpThresholds)) {
        if (v !== undefined && v !== null && v !== "") sanitized[k] = Number(v)
      }
      settings.levelUpThresholds = sanitized
      settings.markModified("levelUpThresholds")
    }

    // ✅ Dynamic Distributor Level Names
    if (levelNames && typeof levelNames === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(levelNames)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.levelNames = sanitized
      settings.markModified("levelNames")
    }

    // ✅ Dynamic Distributor Level Rewards
    if (levelRewards && typeof levelRewards === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(levelRewards)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.levelRewards = sanitized
      settings.markModified("levelRewards")
    }

    // ✅ Dynamic Seller Level Thresholds
    if (sellerLevelUpThresholds && typeof sellerLevelUpThresholds === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(sellerLevelUpThresholds)) {
        if (v !== undefined && v !== null && v !== "") sanitized[k] = Number(v)
      }
      settings.sellerLevelUpThresholds = sanitized
      settings.markModified("sellerLevelUpThresholds")
    }

    // ✅ Dynamic Seller Level Names
    if (sellerLevelNames && typeof sellerLevelNames === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(sellerLevelNames)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.sellerLevelNames = sanitized
      settings.markModified("sellerLevelNames")
    }

    // ✅ Dynamic Seller Level Rewards
    if (sellerLevelRewards && typeof sellerLevelRewards === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(sellerLevelRewards)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.sellerLevelRewards = sanitized
      settings.markModified("sellerLevelRewards")
    }

    // ✅ User Wallet Level Settings (if passed)
    if (userWalletLevelUpThresholds && typeof userWalletLevelUpThresholds === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(userWalletLevelUpThresholds)) {
        if (v !== undefined && v !== null && v !== "") sanitized[k] = Number(v)
      }
      settings.userWalletLevelUpThresholds = sanitized
      settings.markModified("userWalletLevelUpThresholds")
    }
    if (userWalletLevelNames && typeof userWalletLevelNames === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(userWalletLevelNames)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.userWalletLevelNames = sanitized
      settings.markModified("userWalletLevelNames")
    }
    if (userWalletLevelRewards && typeof userWalletLevelRewards === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(userWalletLevelRewards)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.userWalletLevelRewards = sanitized
      settings.markModified("userWalletLevelRewards")
    }

    // ✅ Dist Seller Level Settings (if passed)
    if (distSellerLevelUpThresholds && typeof distSellerLevelUpThresholds === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(distSellerLevelUpThresholds)) {
        if (v !== undefined && v !== null && v !== "") sanitized[k] = Number(v)
      }
      settings.distSellerLevelUpThresholds = sanitized
      settings.markModified("distSellerLevelUpThresholds")
    }
    if (distSellerLevelNames && typeof distSellerLevelNames === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(distSellerLevelNames)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.distSellerLevelNames = sanitized
      settings.markModified("distSellerLevelNames")
    }
    if (distSellerLevelRewards && typeof distSellerLevelRewards === "object") {
      const sanitized = {}
      for (const [k, v] of Object.entries(distSellerLevelRewards)) {
        if (v !== undefined && v !== null) sanitized[k] = String(v)
      }
      settings.distSellerLevelRewards = sanitized
      settings.markModified("distSellerLevelRewards")
    }

    settings.markModified("levelUpThresholds")
    settings.markModified("levelNames")
    settings.markModified("levelRewards")
    settings.markModified("sellerLevelUpThresholds")
    settings.markModified("sellerLevelNames")
    settings.markModified("sellerLevelRewards")
    settings.markModified("userWalletLevelUpThresholds")
    settings.markModified("userWalletLevelNames")
    settings.markModified("userWalletLevelRewards")
    settings.markModified("distSellerLevelUpThresholds")
    settings.markModified("distSellerLevelNames")
    settings.markModified("distSellerLevelRewards")
    settings.markModified("userOrderDistributionRates")
    
    settings.lastUpdatedBy = req.user.id
    await settings.save()
    
    console.log("✅ PPC settings updated")
    
    res.json({ 
      success: true, 
      message: "Settings updated",
      settings 
    })
    
  } catch (err) {
    console.error("Update settings error:", err)
    res.status(500).json({ message: "Failed to update settings" })
  }
})

/* ── GET /api/ppc-settings/ledger — Full statement history for logged-in user ── */
router.get("/ledger", auth, allowRoles("distributor", "seller", "admin"), async (req, res) => {
  try {
    const targetUserId = req.user.id
    const userDoc = await User.findById(targetUserId).select("name fullName role distributorWallet sellerWallet userWalletAsSeller sellerWalletAsSeller totalPPCEarned")

    const query = { toUser: targetUserId, status: { $ne: "rejected" } }
    
    // Date filter
    const { startDate, endDate, walletType, search } = req.query
    if (startDate || endDate) {
      query.createdAt = {}
      if (startDate) query.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const e = new Date(endDate)
        e.setHours(23, 59, 59, 999)
        query.createdAt.$lte = e
      }
    }
    if (walletType && walletType !== "all") {
      query.walletType = walletType
    }

    const records = await Commission.find(query)
      .populate("fromUser", "name fullName role phone email")
      .populate("toUser", "name fullName role")
      .populate("orderId", "total status createdAt")
      .sort({ createdAt: -1 })
      .limit(200)

    res.json({
      success: true,
      user: {
        _id: userDoc._id,
        name: userDoc.name,
        fullName: userDoc.fullName || userDoc.name,
        role: userDoc.role,
        distributorWallet: userDoc.distributorWallet || 0,
        sellerWallet: userDoc.sellerWallet || 0,
        userWalletAsSeller: userDoc.userWalletAsSeller || 0,
        sellerWalletAsSeller: userDoc.sellerWalletAsSeller || 0,
        totalPPCEarned: userDoc.totalPPCEarned || 0
      },
      totalCount: records.length,
      ledger: records.map(r => ({
        _id: r._id,
        date: r.createdAt,
        ppcCount: r.ppcCount || 0,
        ppcBaseRate: r.ppcBaseRate || 40,
        percentageShare: r.percentageShare || 50,
        rupeeValue: r.rupeeValue || 0,
        positionType: r.positionType || "direct",
        walletType: r.walletType,
        isUserOrder: r.isUserOrder || false,
        fromUser: r.fromUser ? {
          _id: r.fromUser._id,
          name: r.fromUser.name,
          fullName: r.fromUser.fullName || r.fromUser.name,
          role: r.fromUser.role,
          phone: r.fromUser.phone
        } : null,
        order: r.orderId ? {
          _id: r.orderId._id,
          total: r.orderId.total,
          status: r.orderId.status
        } : null,
        chainInfo: r.chainInfo || {}
      }))
    })
  } catch (err) {
    console.error("Ledger error:", err)
    res.status(500).json({ success: false, message: "Failed to load PPC ledger" })
  }
})

/* ── GET /api/ppc-settings/ledger/:userId — Admin inspects any user's PPC ledger ── */
router.get("/ledger/:userId", auth, allowRoles("admin"), async (req, res) => {
  try {
    const targetUserId = req.params.userId
    const userDoc = await User.findById(targetUserId).select("name fullName role distributorWallet sellerWallet userWalletAsSeller sellerWalletAsSeller totalPPCEarned")
    if (!userDoc) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    const query = { toUser: targetUserId, status: { $ne: "rejected" } }
    const { startDate, endDate, walletType } = req.query
    if (startDate || endDate) {
      query.createdAt = {}
      if (startDate) query.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const e = new Date(endDate)
        e.setHours(23, 59, 59, 999)
        query.createdAt.$lte = e
      }
    }
    if (walletType && walletType !== "all") {
      query.walletType = walletType
    }

    const records = await Commission.find(query)
      .populate("fromUser", "name fullName role phone email")
      .populate("toUser", "name fullName role")
      .populate("orderId", "total status createdAt")
      .sort({ createdAt: -1 })
      .limit(200)

    res.json({
      success: true,
      user: {
        _id: userDoc._id,
        name: userDoc.name,
        fullName: userDoc.fullName || userDoc.name,
        role: userDoc.role,
        distributorWallet: userDoc.distributorWallet || 0,
        sellerWallet: userDoc.sellerWallet || 0,
        userWalletAsSeller: userDoc.userWalletAsSeller || 0,
        sellerWalletAsSeller: userDoc.sellerWalletAsSeller || 0,
        totalPPCEarned: userDoc.totalPPCEarned || 0
      },
      totalCount: records.length,
      ledger: records.map(r => ({
        _id: r._id,
        date: r.createdAt,
        ppcCount: r.ppcCount || 0,
        ppcBaseRate: r.ppcBaseRate || 40,
        percentageShare: r.percentageShare || 50,
        rupeeValue: r.rupeeValue || 0,
        positionType: r.positionType || "direct",
        walletType: r.walletType,
        isUserOrder: r.isUserOrder || false,
        fromUser: r.fromUser ? {
          _id: r.fromUser._id,
          name: r.fromUser.name,
          fullName: r.fromUser.fullName || r.fromUser.name,
          role: r.fromUser.role,
          phone: r.fromUser.phone
        } : null,
        order: r.orderId ? {
          _id: r.orderId._id,
          total: r.orderId.total,
          status: r.orderId.status
        } : null,
        chainInfo: r.chainInfo || {}
      }))
    })
  } catch (err) {
    console.error("Admin user ledger error:", err)
    res.status(500).json({ success: false, message: "Failed to load user PPC ledger" })
  }
})

// ⭐ Admin triggers monthly lifetime salary payout manually
router.post("/run-salary-payout", auth, allowRoles("admin"), async (req, res) => {
  try {
    const { executeMonthlySalaryPayout } = await import("../services/salaryPayoutService.js")
    const result = await executeMonthlySalaryPayout({ triggeredBy: "admin_manual" })
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router