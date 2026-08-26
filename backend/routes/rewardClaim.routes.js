import express from "express"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import User from "../models/User.js"
import PPCSettings from "../models/PPCSettings.js"
import RewardClaim from "../models/RewardClaim.js"
import {
  notifyRewardClaimRequested,
  notifyRewardPaid,
  notifyRewardRejected,
} from "../utils/notifHelper.js"

const router = express.Router()

/* =====================================================
   WALLET CONFIG — har wallet type ka apna PPC field +
   admin settings key + default values
===================================================== */
const WALLET_CONFIG = {
  userWalletAsSeller: {
    role: "seller",
    ppcField: "userWalletAsSeller",
    thresholdsKey: "userWalletLevelUpThresholds",
    namesKey: "userWalletLevelNames",
    rewardsKey: "userWalletLevelRewards",
    defaultThresholds: { level1: 50, level2: 200, level3: 500, level4: 2000 },
    defaultNames: { level0: "User", level1: "Silver User", level2: "Gold User", level3: "Platinum User", level4: "Diamond User" },
    defaultRewards: { level1: "🎁 ₹250 bonus credit", level2: "🎁 ₹750 bonus credit", level3: "🎁 ₹1500 + free kit", level4: "🎁 ₹5000 + trip" },
  },
  sellerWalletAsSeller: {
    role: "seller",
    ppcField: "sellerWalletAsSeller",
    thresholdsKey: "sellerLevelUpThresholds",
    namesKey: "sellerLevelNames",
    rewardsKey: "sellerLevelRewards",
    defaultThresholds: { level1: 50, level2: 200, level3: 500, level4: 2000 },
    defaultNames: { level0: "Seller", level1: "Silver Seller", level2: "Gold Seller", level3: "Platinum Seller", level4: "Diamond Seller" },
    defaultRewards: { level1: "🎁 ₹250 bonus credit", level2: "🎁 ₹750 bonus credit", level3: "🎁 ₹1500 + free kit", level4: "🎁 ₹5000 + trip" },
  },
  distSellerWallet: {
    role: "distributor",
    ppcField: "sellerWallet",
    thresholdsKey: "distSellerLevelUpThresholds",
    namesKey: "distSellerLevelNames",
    rewardsKey: "distSellerLevelRewards",
    defaultThresholds: { level1: 50, level2: 200, level3: 500, level4: 2000 },
    defaultNames: { level0: "Seller", level1: "Silver Seller", level2: "Gold Seller", level3: "Platinum Seller", level4: "Diamond Seller" },
    defaultRewards: { level1: "🎁 ₹250 bonus credit", level2: "🎁 ₹750 bonus credit", level3: "🎁 ₹1500 + free kit", level4: "🎁 ₹5000 + trip" },
  },
  distributorWallet: {
    role: "distributor",
    ppcField: "distributorWallet",
    thresholdsKey: "levelUpThresholds",
    namesKey: "levelNames",
    rewardsKey: "levelRewards",
    defaultThresholds: { level1: 100, level2: 500, level3: 1000, level4: 5000 },
    defaultNames: { level0: "Distributor", level1: "Senior Distributor", level2: "Gold Distributor", level3: "Platinum Distributor", level4: "Diamond Distributor" },
    defaultRewards: { level1: "🎁 ₹500 bonus credit", level2: "🎁 ₹1500 bonus credit", level3: "🎁 ₹3000 + free kit", level4: "🎁 ₹10000 + trip" },
  },
}

const getWalletsForRole = (role) =>
  Object.keys(WALLET_CONFIG).filter((k) => WALLET_CONFIG[k].role === role)

/* =====================================================
   GET /api/rewards/my
   Logged-in user (seller/distributor) ke saare wallets ke
   levels + unka claim status dikhao
===================================================== */
router.get("/my", protect, allowRoles("seller", "distributor"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: "User not found" })

    const settings = await PPCSettings.getSettings()
    const walletKeys = getWalletsForRole(user.role)

    const existingClaims = await RewardClaim.find({ userId: user._id })

    const wallets = walletKeys.map((walletType) => {
      const cfg = WALLET_CONFIG[walletType]
      const thresholds = settings[cfg.thresholdsKey] || cfg.defaultThresholds
      const names = settings[cfg.namesKey] || cfg.defaultNames
      const rewards = settings[cfg.rewardsKey] || cfg.defaultRewards
      const currentPPC = user.role === "seller"
        ? (user.userWalletAsSeller || 0) + (user.sellerWalletAsSeller || 0)
        : (user[cfg.ppcField] || 0)

      const levels = [1, 2, 3, 4].map((level) => {
        const threshold = thresholds[`level${level}`] || 0
        const achieved = currentPPC >= threshold
        const claim = existingClaims.find(
          (c) => c.walletType === walletType && c.level === level
        )

        return {
          level,
          levelName: names[`level${level}`] || `Level ${level}`,
          threshold,
          rewardText: rewards[`level${level}`] || "",
          achieved,
          claimStatus: claim ? claim.status : "not_claimed", // not_claimed | pending | paid | rejected
          claimId: claim ? claim._id : null,
          paidAt: claim?.paidAt || null,
        }
      })

      return { walletType, currentPPC, levels }
    })

    res.json({ role: user.role, wallets })
  } catch (err) {
    console.error("Reward /my error:", err)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   POST /api/rewards/claim
   Body: { walletType, level }
   User apna complete hua reward claim kare — admin ko request jaati hai
===================================================== */
router.post("/claim", protect, allowRoles("seller", "distributor"), async (req, res) => {
  try {
    const { walletType, level } = req.body
    const lvl = Number(level)

    const cfg = WALLET_CONFIG[walletType]
    if (!cfg) return res.status(400).json({ message: "Invalid wallet type" })
    if (cfg.role !== req.user.role) {
      return res.status(403).json({ message: "Ye wallet aapke role ke liye nahi hai" })
    }
    if (![1, 2, 3, 4].includes(lvl)) {
      return res.status(400).json({ message: "Invalid level" })
    }

    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: "User not found" })

    const settings = await PPCSettings.getSettings()
    const thresholds = settings[cfg.thresholdsKey] || cfg.defaultThresholds
    const names = settings[cfg.namesKey] || cfg.defaultNames
    const rewards = settings[cfg.rewardsKey] || cfg.defaultRewards

    const threshold = thresholds[`level${lvl}`] || 0
    const currentPPC = user.role === "seller"
      ? (user.userWalletAsSeller || 0) + (user.sellerWalletAsSeller || 0)
      : (user[cfg.ppcField] || 0)

    if (currentPPC < threshold) {
      return res.status(400).json({
        message: `Abhi ye level complete nahi hua. Required: ${threshold} PPC, Aapke paas: ${currentPPC} PPC`
      })
    }

    // ⭐ Already claimed (pending ya paid) to dobara nahi
    const already = await RewardClaim.findOne({
      userId: user._id,
      walletType,
      level: lvl,
      status: { $in: ["pending", "paid"] }
    })
    if (already) {
      return res.status(400).json({
        message: already.status === "paid" ? "Ye reward already paid ho chuki hai" : "Ye reward already claim ki hui hai, admin approval pending hai"
      })
    }

    const levelName = names[`level${lvl}`] || `Level ${lvl}`
    const rewardText = rewards[`level${lvl}`] || ""

    const claim = await RewardClaim.create({
      userId: user._id,
      walletType,
      level: lvl,
      levelName,
      rewardText,
      ppcRequired: threshold,
      ppcAtClaim: currentPPC,
      status: "pending",
      requestedAt: new Date(),
    })

    // 🔔 Admins ko batao
    try {
      const admins = await User.find({ role: "admin", isDeleted: { $ne: true } }).select("_id")
      await notifyRewardClaimRequested({
        user,
        levelName,
        rewardText,
        adminIds: admins.map((a) => a._id),
      })
    } catch (ne) {
      console.error("Reward claim notif error:", ne.message)
    }

    res.json({ success: true, claim, message: "Reward claim request admin ko bhej di gayi hai" })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Ye reward already claim ki hui hai" })
    }
    console.error("Reward claim error:", err)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ADMIN — GET /api/rewards/admin/pending
===================================================== */
router.get("/admin/pending", protect, allowRoles("admin"), async (req, res) => {
  try {
    const claims = await RewardClaim.find({ status: "pending" })
      .populate("userId", "name email role")
      .sort({ requestedAt: 1 }) // oldest first
    res.json(claims)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ADMIN — GET /api/rewards/admin/all (history)
===================================================== */
router.get("/admin/all", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { status } = req.query
    const query = status && status !== "all" ? { status } : {}
    const claims = await RewardClaim.find(query)
      .populate("userId", "name email role")
      .populate("paidBy", "name")
      .sort({ createdAt: -1 })
      .limit(500)
    res.json(claims)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ADMIN — PUT /api/rewards/admin/pay/:id
   Payment kar di gayi — reward ko "paid" mark karo
===================================================== */
router.put("/admin/pay/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const claim = await RewardClaim.findById(req.params.id)
    if (!claim) return res.status(404).json({ message: "Claim not found" })
    if (claim.status !== "pending") {
      return res.status(400).json({ message: `Already ${claim.status}` })
    }

    claim.status = "paid"
    claim.paidAt = new Date()
    claim.paidBy = req.user.id
    await claim.save()

    // 🔔 User ko batao
    try {
      await notifyRewardPaid({
        userId: claim.userId,
        levelName: claim.levelName,
        rewardText: claim.rewardText,
      })
    } catch (ne) {
      console.error("Reward paid notif error:", ne.message)
    }

    res.json({ success: true, claim, message: "Reward paid — user ko tick dikhega" })
  } catch (err) {
    console.error("Reward pay error:", err)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ADMIN — PUT /api/rewards/admin/reject/:id
   Body: { note }
===================================================== */
router.put("/admin/reject/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { note = "" } = req.body
    const claim = await RewardClaim.findById(req.params.id)
    if (!claim) return res.status(404).json({ message: "Claim not found" })
    if (claim.status !== "pending") {
      return res.status(400).json({ message: `Already ${claim.status}` })
    }

    claim.status = "rejected"
    claim.rejectedAt = new Date()
    claim.adminNote = note.trim()
    await claim.save()

    try {
      await notifyRewardRejected({
        userId: claim.userId,
        levelName: claim.levelName,
        note: claim.adminNote,
      })
    } catch (ne) {
      console.error("Reward reject notif error:", ne.message)
    }

    // ⭐ Reject hone ke baad user dobara claim kar sakta hai (unique index sirf pending/paid par lagta hai)
    res.json({ success: true, claim, message: "Reward claim rejected" })
  } catch (err) {
    console.error("Reward reject error:", err)
    res.status(500).json({ message: err.message })
  }
})

export default router
