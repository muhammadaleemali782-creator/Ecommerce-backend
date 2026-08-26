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

    // ✅ Level up thresholds
    if (levelUpThresholds) {
      if (!settings.levelUpThresholds) settings.levelUpThresholds = {}
      if (levelUpThresholds.level1 !== undefined) settings.levelUpThresholds.level1 = Number(levelUpThresholds.level1)
      if (levelUpThresholds.level2 !== undefined) settings.levelUpThresholds.level2 = Number(levelUpThresholds.level2)
      if (levelUpThresholds.level3 !== undefined) settings.levelUpThresholds.level3 = Number(levelUpThresholds.level3)
      if (levelUpThresholds.level4 !== undefined) settings.levelUpThresholds.level4 = Number(levelUpThresholds.level4)
    }

    // ✅ Level names
    if (levelNames) {
      if (!settings.levelNames) settings.levelNames = {}
      if (levelNames.level0 !== undefined) settings.levelNames.level0 = levelNames.level0
      if (levelNames.level1 !== undefined) settings.levelNames.level1 = levelNames.level1
      if (levelNames.level2 !== undefined) settings.levelNames.level2 = levelNames.level2
      if (levelNames.level3 !== undefined) settings.levelNames.level3 = levelNames.level3
      if (levelNames.level4 !== undefined) settings.levelNames.level4 = levelNames.level4
    }

    // ✅ Level rewards — admin control
    if (levelRewards) {
      if (!settings.levelRewards) settings.levelRewards = {}
      if (levelRewards.level1 !== undefined) settings.levelRewards.level1 = levelRewards.level1
      if (levelRewards.level2 !== undefined) settings.levelRewards.level2 = levelRewards.level2
      if (levelRewards.level3 !== undefined) settings.levelRewards.level3 = levelRewards.level3
      if (levelRewards.level4 !== undefined) settings.levelRewards.level4 = levelRewards.level4
    }

    // ✅ Seller Level Up Thresholds
    if (sellerLevelUpThresholds) {
      if (!settings.sellerLevelUpThresholds) settings.sellerLevelUpThresholds = {}
      if (sellerLevelUpThresholds.level1 !== undefined) settings.sellerLevelUpThresholds.level1 = Number(sellerLevelUpThresholds.level1)
      if (sellerLevelUpThresholds.level2 !== undefined) settings.sellerLevelUpThresholds.level2 = Number(sellerLevelUpThresholds.level2)
      if (sellerLevelUpThresholds.level3 !== undefined) settings.sellerLevelUpThresholds.level3 = Number(sellerLevelUpThresholds.level3)
      if (sellerLevelUpThresholds.level4 !== undefined) settings.sellerLevelUpThresholds.level4 = Number(sellerLevelUpThresholds.level4)
    }
    // ✅ Seller Level Names
    if (sellerLevelNames) {
      if (!settings.sellerLevelNames) settings.sellerLevelNames = {}
      if (sellerLevelNames.level0 !== undefined) settings.sellerLevelNames.level0 = sellerLevelNames.level0
      if (sellerLevelNames.level1 !== undefined) settings.sellerLevelNames.level1 = sellerLevelNames.level1
      if (sellerLevelNames.level2 !== undefined) settings.sellerLevelNames.level2 = sellerLevelNames.level2
      if (sellerLevelNames.level3 !== undefined) settings.sellerLevelNames.level3 = sellerLevelNames.level3
      if (sellerLevelNames.level4 !== undefined) settings.sellerLevelNames.level4 = sellerLevelNames.level4
    }
    // ✅ Seller Level Rewards
    if (sellerLevelRewards) {
      if (!settings.sellerLevelRewards) settings.sellerLevelRewards = {}
      if (sellerLevelRewards.level1 !== undefined) settings.sellerLevelRewards.level1 = sellerLevelRewards.level1
      if (sellerLevelRewards.level2 !== undefined) settings.sellerLevelRewards.level2 = sellerLevelRewards.level2
      if (sellerLevelRewards.level3 !== undefined) settings.sellerLevelRewards.level3 = sellerLevelRewards.level3
      if (sellerLevelRewards.level4 !== undefined) settings.sellerLevelRewards.level4 = sellerLevelRewards.level4
    }

    // ✅ User Wallet Level Up Thresholds (separate from Direct Seller Wallet)
    if (userWalletLevelUpThresholds) {
      if (!settings.userWalletLevelUpThresholds) settings.userWalletLevelUpThresholds = {}
      if (userWalletLevelUpThresholds.level1 !== undefined) settings.userWalletLevelUpThresholds.level1 = Number(userWalletLevelUpThresholds.level1)
      if (userWalletLevelUpThresholds.level2 !== undefined) settings.userWalletLevelUpThresholds.level2 = Number(userWalletLevelUpThresholds.level2)
      if (userWalletLevelUpThresholds.level3 !== undefined) settings.userWalletLevelUpThresholds.level3 = Number(userWalletLevelUpThresholds.level3)
      if (userWalletLevelUpThresholds.level4 !== undefined) settings.userWalletLevelUpThresholds.level4 = Number(userWalletLevelUpThresholds.level4)
    }
    // ✅ User Wallet Level Names
    if (userWalletLevelNames) {
      if (!settings.userWalletLevelNames) settings.userWalletLevelNames = {}
      if (userWalletLevelNames.level0 !== undefined) settings.userWalletLevelNames.level0 = userWalletLevelNames.level0
      if (userWalletLevelNames.level1 !== undefined) settings.userWalletLevelNames.level1 = userWalletLevelNames.level1
      if (userWalletLevelNames.level2 !== undefined) settings.userWalletLevelNames.level2 = userWalletLevelNames.level2
      if (userWalletLevelNames.level3 !== undefined) settings.userWalletLevelNames.level3 = userWalletLevelNames.level3
      if (userWalletLevelNames.level4 !== undefined) settings.userWalletLevelNames.level4 = userWalletLevelNames.level4
    }
    // ✅ User Wallet Level Rewards
    if (userWalletLevelRewards) {
      if (!settings.userWalletLevelRewards) settings.userWalletLevelRewards = {}
      if (userWalletLevelRewards.level1 !== undefined) settings.userWalletLevelRewards.level1 = userWalletLevelRewards.level1
      if (userWalletLevelRewards.level2 !== undefined) settings.userWalletLevelRewards.level2 = userWalletLevelRewards.level2
      if (userWalletLevelRewards.level3 !== undefined) settings.userWalletLevelRewards.level3 = userWalletLevelRewards.level3
      if (userWalletLevelRewards.level4 !== undefined) settings.userWalletLevelRewards.level4 = userWalletLevelRewards.level4
    }

    // ✅ Distributor's OWN Direct Seller Wallet — Level Up Thresholds
    if (distSellerLevelUpThresholds) {
      if (!settings.distSellerLevelUpThresholds) settings.distSellerLevelUpThresholds = {}
      if (distSellerLevelUpThresholds.level1 !== undefined) settings.distSellerLevelUpThresholds.level1 = Number(distSellerLevelUpThresholds.level1)
      if (distSellerLevelUpThresholds.level2 !== undefined) settings.distSellerLevelUpThresholds.level2 = Number(distSellerLevelUpThresholds.level2)
      if (distSellerLevelUpThresholds.level3 !== undefined) settings.distSellerLevelUpThresholds.level3 = Number(distSellerLevelUpThresholds.level3)
      if (distSellerLevelUpThresholds.level4 !== undefined) settings.distSellerLevelUpThresholds.level4 = Number(distSellerLevelUpThresholds.level4)
    }
    // ✅ Distributor's Direct Seller Wallet — Level Names
    if (distSellerLevelNames) {
      if (!settings.distSellerLevelNames) settings.distSellerLevelNames = {}
      if (distSellerLevelNames.level0 !== undefined) settings.distSellerLevelNames.level0 = distSellerLevelNames.level0
      if (distSellerLevelNames.level1 !== undefined) settings.distSellerLevelNames.level1 = distSellerLevelNames.level1
      if (distSellerLevelNames.level2 !== undefined) settings.distSellerLevelNames.level2 = distSellerLevelNames.level2
      if (distSellerLevelNames.level3 !== undefined) settings.distSellerLevelNames.level3 = distSellerLevelNames.level3
      if (distSellerLevelNames.level4 !== undefined) settings.distSellerLevelNames.level4 = distSellerLevelNames.level4
    }
    // ✅ Distributor's Direct Seller Wallet — Level Rewards
    if (distSellerLevelRewards) {
      if (!settings.distSellerLevelRewards) settings.distSellerLevelRewards = {}
      if (distSellerLevelRewards.level1 !== undefined) settings.distSellerLevelRewards.level1 = distSellerLevelRewards.level1
      if (distSellerLevelRewards.level2 !== undefined) settings.distSellerLevelRewards.level2 = distSellerLevelRewards.level2
      if (distSellerLevelRewards.level3 !== undefined) settings.distSellerLevelRewards.level3 = distSellerLevelRewards.level3
      if (distSellerLevelRewards.level4 !== undefined) settings.distSellerLevelRewards.level4 = distSellerLevelRewards.level4
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

export default router