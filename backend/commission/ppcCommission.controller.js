import mongoose from "mongoose"
import Commission from "./commission.model.js"
import User from "../models/User.js"
import Product from "../models/Product.js"
import PPCSettings from "../models/PPCSettings.js"
import { RoyaltyPool } from "../models/RoyaltyPool.js"
import { notifyLevelUp } from "../utils/notifHelper.js"

/*
  ═══════════════════════════════════════════════════════════
  NEW PPC DISTRIBUTION LOGIC (as per owner requirement)
  ───────────────────────────────────────────────────────────

  Hierarchy: Distributor → Seller (parent) → Seller (direct) → User

  Jab User kharide / order place kare:
  - User ko koi PPC nahi milta

  PPC (e.g. 1 PPC = ₹40) distribute hota hai:
  ┌─────────────────────────────────────────────────────┐
  │ Direct Seller (user ka upar wala)  → 50% = ₹20     │
  │ Parent Seller (agar hai)           → 25% = ₹10     │
  │ Distributor (mandatory)            → 25% = ₹10     │
  │ TOTAL                              → 100% = ₹40    │
  └─────────────────────────────────────────────────────┘

  Agar direct seller ke upar koi SELLER nahi hai (seedha distributor hai):
  ┌─────────────────────────────────────────────────────┐
  │ Direct Seller                      → 50% = ₹20     │
  │ Distributor (baaki 50%)            → 50% = ₹20     │
  │ TOTAL                              → 100% = ₹40    │
  └─────────────────────────────────────────────────────┘

  Wallet types:
  - Seller earns from user   → userWalletAsSeller  (50%)
  - Parent Seller earns      → sellerWalletAsSeller (25%)
  - Distributor earns        → sellerWallet        (25% or 50%)
  ═══════════════════════════════════════════════════════════
*/

/* ── Walk up tree to find nearest ancestor of given role ── */
const findAncestorByRole = async (userId, targetRole, visited = new Set()) => {
  if (!userId || visited.has(String(userId))) return null
  visited.add(String(userId))

  const parent = await User.findById(userId).select("_id role parentId isDeleted name")
  if (!parent || parent.isDeleted) return null
  if (parent.role === "admin") return null          // stop at admin
  if (parent.role === targetRole) return parent
  return findAncestorByRole(parent.parentId, targetRole, visited)
}

/* ── Save one commission entry ── */
const saveCommission = async ({
  fromUser, toUser, orderId,
  ppcCount, ppcBaseRate,
  positionType, percentageShare,
  rupeeValue, walletType, level,
  isUserOrder = false,
  chainInfo = {},
}) => {
  // ⭐ STRICT RULE: Admin and normal User NEVER receive PPC commissions
  if (!toUser) return
  const recipient = await User.findById(toUser).select("role isDeleted name")
  if (!recipient || recipient.role === "admin" || recipient.role === "user" || recipient.isDeleted) {
    console.log(`🚫 PPC Commission Skipped: ${recipient?.name || toUser} has role "${recipient?.role}" (Admin/User not eligible for PPC)`)
    return
  }

  await Commission.create({
    fromUser, toUser, orderId,
    ppcCount, ppcBaseRate,
    positionType, percentageShare,
    rupeeValue, amount: rupeeValue,
    level, status: "approved",
    walletType,
    isUserOrder,
    chainInfo,
  })
}

/* ── Level helper: PPC total se current level nikalo ── */
const calcLevel = (ppcTotal, thresholds) => {
  if (ppcTotal >= (thresholds.level4 || Infinity)) return 4
  if (ppcTotal >= (thresholds.level3 || Infinity)) return 3
  if (ppcTotal >= (thresholds.level2 || Infinity)) return 2
  if (ppcTotal >= (thresholds.level1 || Infinity)) return 1
  return 0
}

/* ── Naya PPC add hone ke baad check karo level badha ya nahi, agar badha to notify karo ──
   userId       : jiska PPC update hua
   walletKind   : "distributorWallet" | "distSellerWallet" | "userWallet" | "sellerWalletAsSeller"
                  — har wallet ki apni alag settings hoti hain (admin PPC settings page se)
   oldPPC       : update se PEHLE ka PPC total
   newPPC       : update ke BAAD ka PPC total
*/
const checkAndNotifyLevelUp = async (userId, walletKind, oldPPC, newPPC) => {
  try {
    const settings = await PPCSettings.getSettings()

    // ⭐ Har wallet apni khud ki settings use kare — koi bhi do wallets share nahi karte
    const CONFIG = {
      distributorWallet: {
        thresholds: settings.levelUpThresholds || { level1:100, level2:500, level3:1000, level4:5000 },
        names:      settings.levelNames        || { level1:"Senior Distributor", level2:"Gold Distributor", level3:"Platinum Distributor", level4:"Diamond Distributor" },
        rewards:    settings.levelRewards      || {},
        role:       "distributor",
      },
      distSellerWallet: {
        thresholds: settings.distSellerLevelUpThresholds || { level1:50, level2:200, level3:500, level4:2000 },
        names:      settings.distSellerLevelNames        || { level1:"Silver Seller", level2:"Gold Seller", level3:"Platinum Seller", level4:"Diamond Seller" },
        rewards:    settings.distSellerLevelRewards      || {},
        role:       "distributor",
      },
      userWallet: {
        thresholds: settings.userWalletLevelUpThresholds || { level1:50, level2:200, level3:500, level4:2000 },
        names:      settings.userWalletLevelNames        || { level1:"Silver User", level2:"Gold User", level3:"Platinum User", level4:"Diamond User" },
        rewards:    settings.userWalletLevelRewards      || {},
        role:       "seller",
      },
      sellerWalletAsSeller: {
        thresholds: settings.sellerLevelUpThresholds || { level1:50, level2:200, level3:500, level4:2000 },
        names:      settings.sellerLevelNames        || { level1:"Silver Seller", level2:"Gold Seller", level3:"Platinum Seller", level4:"Diamond Seller" },
        rewards:    settings.sellerLevelRewards      || {},
        role:       "seller",
      },
    }

    const cfg = CONFIG[walletKind]
    if (!cfg) { console.error("Unknown walletKind for level-up check:", walletKind); return }

    const oldLevel = calcLevel(oldPPC, cfg.thresholds)
    const newLevel = calcLevel(newPPC, cfg.thresholds)

    if (newLevel > oldLevel) {
      // Jitne levels cross hue (agar ek hi order mein multiple level cross ho jaye)
      for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
        const name   = cfg.names[`level${lvl}`] || `Level ${lvl}`
        const reward = cfg.rewards[`level${lvl}`] || ""
        await notifyLevelUp({ userId, role: cfg.role, levelName: name, reward })
      }
    }
  } catch (err) {
    console.error("Level-up notif check error:", err.message)
  }
}

/* ══════════════════════════════════════════════════════════
   MAIN FUNCTION: called after Admin final confirms order
══════════════════════════════════════════════════════════ */
export const createPPCCommissionFromOrder = async (order) => {
  try {
    console.log("🔥 PPC COMMISSION START for order:", order._id)

    if (!order?.sellerId) {
      console.log("⚠️ Invalid order — no sellerId")
      return
    }

    // Prevent duplicate processing
    const existing = await Commission.findOne({ orderId: order._id })
    if (existing) {
      console.log("⚠️ Already processed order:", order._id)
      return
    }

    // Get PPC settings
    const settings    = await PPCSettings.getSettings()
    const ppcRate     = settings.basePPCValue   // e.g. ₹40 per PPC

    // ── Calculate total PPC from all order items ──
    let totalPPC = 0
    if (order.items?.length > 0) {
      for (const item of order.items) {
        const productId = item.productId || item._id || item.product
        if (productId) {
          const product = await Product.findById(productId).select("ppcReward")
          const qty     = item.qty || item.quantity || 1
          totalPPC     += (product?.ppcReward || 1) * qty
        } else {
          totalPPC += (item.ppcReward || 1) * (item.qty || 1)
        }
      }
    }
    if (totalPPC === 0) totalPPC = 1   // fallback

    // ── Accumulate Company-Wide Royalty Pool (for Lifetime Distributor Royalty) ──
    try {
      const pool = await RoyaltyPool.getPool()
      if (pool && pool.isActive) {
        if (!pool.currentCycle) {
          pool.currentCycle = {
            startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            totalCompanyPPC: 0,
            totalCompanySalesRupees: 0,
            accumulatedPoolPPC: 0,
            accumulatedPoolRupees: 0
          }
        }
        pool.currentCycle.totalCompanyPPC += totalPPC
        pool.currentCycle.totalCompanySalesRupees += (order.total || 0)
        pool.currentCycle.accumulatedPoolPPC = (pool.currentCycle.totalCompanyPPC * pool.poolPercentage) / 100
        pool.currentCycle.accumulatedPoolRupees = pool.currentCycle.accumulatedPoolPPC * ppcRate
        await pool.save()
        console.log(`👑 Accumulated ${totalPPC} PPC to Company Royalty Pool (Current Pool: ${pool.currentCycle.accumulatedPoolPPC} PPC)`)
      }
    } catch (poolErr) {
      console.error("Royalty pool accumulation error:", poolErr.message)
    }

    // ── Detect who placed the order ──
    // ✅ FIX: Agar order.userId exist karta hai → USER ne place kiya
    // (after sellerId fix, sellerId = parent seller, userId = actual user)
    const isUserOrder = !!order.userId

    const sellerDoc = await User.findById(order.sellerId)
      .select("_id name role parentId")

    console.log(`📋 Order placed by: ${isUserOrder ? "USER" : "SELLER"} | sellerId role: ${sellerDoc?.role}`)

    // ── Find distributor ──
    const searchFrom = sellerDoc?.parentId
    const distributor = searchFrom
      ? await findAncestorByRole(searchFrom, "distributor")
      : null

    console.log(`💎 Total PPC: ${totalPPC} | Rate: ₹${ppcRate} | Distributor: ${distributor?.name || "none"}`)

    // ══════════════════════════════════════════════════════
    //  USER NE ORDER KIYA → Sirf 50/50 split
    //  Direct Seller 50% + Distributor 50%
    // ══════════════════════════════════════════════════════
    if (isUserOrder) {
      // ✅ Find direct seller — walk up tree if needed (handles nested users)
      let directSeller = await User.findById(order.sellerId)
        .select("_id name role parentId userWalletAsSeller totalPPCEarned")

      // Agar sellerId still user hai (nested: US002→US001→DS001) → walk up
      if (directSeller?.role === "user") {
        let curr = directSeller
        const seen = new Set()
        while (curr && curr.role !== "seller" && curr.role !== "distributor") {
          if (seen.has(String(curr._id))) break
          seen.add(String(curr._id))
          if (!curr.parentId) { curr = null; break }
          curr = await User.findById(curr.parentId)
            .select("_id name role parentId userWalletAsSeller totalPPCEarned")
        }
        if (curr?.role === "seller") directSeller = curr
      }

      // ✅ Chain info — actual names store karo frontend display ke liye
      const chain = {
        directSellerName: directSeller?.name || "",
        distributorName:  distributor?.name  || "",
        parentSellerName: "",
        isUserOrder:      true,
      }

      // ⭐ Admin-configurable split (PPC Settings → User Order Distribution)
      const userSplit = settings.userOrderDistributionRates || { directSeller: 50, distributor: 50 }
      const directSellerPct = Number(userSplit.directSeller ?? 50)
      const distributorPct  = Number(userSplit.distributor ?? 50)

      if (directSeller && directSeller.role === "seller") {
        const sellerRupees = totalPPC * ppcRate * (directSellerPct / 100)
        await saveCommission({
          fromUser:        order.userId || order.sellerId,
          toUser:          directSeller._id,
          orderId:         order._id,
          ppcCount:        totalPPC,
          ppcBaseRate:     ppcRate,
          positionType:    "direct",
          percentageShare: directSellerPct,
          rupeeValue:      sellerRupees,
          walletType:      "userWallet",
          level:           1,
          isUserOrder:     true,
          chainInfo:       chain,
        })
        const oldSellerPPC = directSeller.userWalletAsSeller || 0
        directSeller.userWalletAsSeller = oldSellerPPC + totalPPC
        directSeller.totalPPCEarned     = (directSeller.totalPPCEarned || 0) + totalPPC
        await directSeller.save()
        await checkAndNotifyLevelUp(directSeller._id, "userWallet", oldSellerPPC, directSeller.userWalletAsSeller)
      }

      if (distributor && distributor.role === "distributor") {
        const distRupees = totalPPC * ppcRate * (distributorPct / 100)
        await saveCommission({
          fromUser:        order.userId || order.sellerId,
          toUser:          distributor._id,
          orderId:         order._id,
          ppcCount:        totalPPC,
          ppcBaseRate:     ppcRate,
          positionType:    "distributor",
          percentageShare: distributorPct,
          rupeeValue:      distRupees,
          walletType:      "sellerWallet",
          level:           2,
          isUserOrder:     true,
          chainInfo:       chain,
        })
        const dist = await User.findById(distributor._id).select("sellerWallet totalPPCEarned parentId")
        if (dist) {
          const oldDistPPC = dist.sellerWallet || 0
          dist.sellerWallet   = oldDistPPC + totalPPC
          dist.totalPPCEarned = (dist.totalPPCEarned || 0) + totalPPC
          await dist.save()
          await checkAndNotifyLevelUp(dist._id, "distSellerWallet", oldDistPPC, dist.sellerWallet)

          // ✅ Parent distributor ke distributorWallet mein track karo (locked, level progression)
          if (dist.parentId) {
            const parentDist = await User.findById(dist.parentId).select("role distributorWallet")
            if (parentDist && parentDist.role === "distributor") {
              parentDist.distributorWallet = (parentDist.distributorWallet || 0) + totalPPC
              await parentDist.save()
              console.log(`📊 Parent Distributor ${dist.parentId} → +${totalPPC} PPC in distributorWallet (locked)`)
            }
          }
        }
        console.log(`✅ Distributor ${distributor.name} → ${totalPPC} PPC [50%] = ₹${distRupees}`)
      }

      console.log("🎉 USER ORDER PPC distributed (50/50)!")
      return
    }

    // ══════════════════════════════════════════════════════
    //  SELLER NE ORDER KIYA → 3-way split
    //  Direct Seller 50% + Parent Seller 25% + Distributor 25/50%
    // ══════════════════════════════════════════════════════
    const directSeller = await User.findById(order.sellerId)
      .select("_id name role parentId userWalletAsSeller totalPPCEarned")
    if (!directSeller) {
      console.log("⚠️ Direct seller not found")
      return
    }

    console.log(`👤 Direct Seller: ${directSeller.name} (${directSeller.role})`)

    // ── Find parent seller ──
    const parentSeller = directSeller.parentId
      ? await findAncestorByRole(directSeller.parentId, "seller")
      : null

    console.log(`👤 Parent Seller: ${parentSeller?.name || "none"}`)
    console.log(`👤 Distributor: ${distributor?.name || "none"}`)

    // ✅ Chain info for all seller order commissions
    const sellerChain = {
      directSellerName: directSeller.name || "",
      parentSellerName: parentSeller?.name || "",
      distributorName:  distributor?.name  || "",
      isUserOrder:      false,
    }

    // ══════════════════════════════════════════════════════
    //  STEP 1: Direct Seller → 50% always
    // ══════════════════════════════════════════════════════
    if (directSeller && directSeller.role === "seller") {
      const directSellerRupees = totalPPC * ppcRate * 0.50

      await saveCommission({
        fromUser:        order.sellerId,
        toUser:          directSeller._id,
        orderId:         order._id,
        ppcCount:        totalPPC,
        ppcBaseRate:     ppcRate,
        positionType:    "direct",
        percentageShare: 50,
        rupeeValue:      directSellerRupees,
        walletType:      "userWallet",
        level:           1,
        isUserOrder:     false,
        chainInfo:       sellerChain,
      })

      const oldDirectSellerPPC = directSeller.userWalletAsSeller || 0
      directSeller.userWalletAsSeller = oldDirectSellerPPC + totalPPC
      directSeller.totalPPCEarned     = (directSeller.totalPPCEarned || 0) + totalPPC
      await directSeller.save()
      await checkAndNotifyLevelUp(directSeller._id, "userWallet", oldDirectSellerPPC, directSeller.userWalletAsSeller)

      console.log(`✅ Direct Seller ${directSeller.name} → ${totalPPC} PPC (₹${directSellerRupees}) [50%] → userWallet`)
    }

    // ══════════════════════════════════════════════════════
    //  STEP 2: Parent Seller (agar hai) → 25%
    // ══════════════════════════════════════════════════════
    let remainingForDist = 50   // distributor ka default share

    if (parentSeller && parentSeller.role === "seller") {
      const parentSellerRupees = totalPPC * ppcRate * 0.25   // 25%

      await saveCommission({
        fromUser:        order.sellerId,
        toUser:          parentSeller._id,
        orderId:         order._id,
        ppcCount:        totalPPC,
        ppcBaseRate:     ppcRate,
        positionType:    "parent",
        percentageShare: 25,
        rupeeValue:      parentSellerRupees,
        walletType:      "sellerWalletAsSeller",
        level:           2,
        isUserOrder:     false,
        chainInfo:       sellerChain,
      })

      const pSeller = await User.findById(parentSeller._id)
        .select("sellerWalletAsSeller totalPPCEarned")
      if (pSeller) {
        const oldPSellerPPC = pSeller.sellerWalletAsSeller || 0
        pSeller.sellerWalletAsSeller = oldPSellerPPC + totalPPC
        pSeller.totalPPCEarned       = (pSeller.totalPPCEarned || 0) + totalPPC
        await pSeller.save()
        await checkAndNotifyLevelUp(pSeller._id, "sellerWalletAsSeller", oldPSellerPPC, pSeller.sellerWalletAsSeller)
      }

      console.log(`✅ Parent Seller ${parentSeller.name} → ${totalPPC} PPC (₹${parentSellerRupees}) [25%] → sellerWalletAsSeller`)
      remainingForDist = 25   // distributor ko sirf 25% milega
    } else {
      console.log(`ℹ️ No parent seller — distributor gets extra 25% (total 50%)`)
      remainingForDist = 50   // koi parent seller nahi → distributor ko 50%
    }

    // ══════════════════════════════════════════════════════
    //  STEP 3: Distributor → mandatory (25% or 50%)
    // ══════════════════════════════════════════════════════
    if (distributor && distributor.role === "distributor") {
      const distRupees = totalPPC * ppcRate * (remainingForDist / 100)

      await saveCommission({
        fromUser:        order.sellerId,
        toUser:          distributor._id,
        orderId:         order._id,
        ppcCount:        totalPPC,
        ppcBaseRate:     ppcRate,
        positionType:    "distributor",
        percentageShare: remainingForDist,
        rupeeValue:      distRupees,
        walletType:      "sellerWallet",
        level:           3,
        isUserOrder:     false,
        chainInfo:       sellerChain,
      })

      const dist = await User.findById(distributor._id)
        .select("sellerWallet totalPPCEarned parentId")
      if (dist) {
        const oldDistPPC2 = dist.sellerWallet || 0
        dist.sellerWallet    = oldDistPPC2 + totalPPC
        dist.totalPPCEarned  = (dist.totalPPCEarned || 0) + totalPPC
        await dist.save()
        await checkAndNotifyLevelUp(dist._id, "distSellerWallet", oldDistPPC2, dist.sellerWallet)

        // ✅ Parent distributor ke distributorWallet mein track karo (locked, level progression)
        if (dist.parentId) {
          const parentDist = await User.findById(dist.parentId).select("role distributorWallet")
          if (parentDist && parentDist.role === "distributor") {
            parentDist.distributorWallet = (parentDist.distributorWallet || 0) + totalPPC
            await parentDist.save()
            console.log(`📊 Parent Distributor → +${totalPPC} PPC in distributorWallet (locked)`)
          }
        }
      }

      console.log(`✅ Distributor ${distributor.name} → ${totalPPC} PPC (₹${distRupees}) [${remainingForDist}%] → sellerWallet`)
    } else {
      console.log(`ℹ️ No distributor found — remaining ${remainingForDist}% unallocated`)
    }

    console.log("🎉 PPC Commission distributed successfully!")

  } catch (err) {
    console.error("❌ PPC Commission error:", err)
  }
}

/* ══════════════════════════════════════════════════════════
   GET MY PPC WALLET — role-based wallet view
══════════════════════════════════════════════════════════ */
export const getMyPPCWallet = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" })

    const user = await User.findById(req.user.id)
      .select("name role distributorWallet sellerWallet sellerWalletAsSeller userWalletAsSeller totalPPCEarned totalWithdrawn")
    if (!user) return res.status(404).json({ message: "User not found" })

    const settings = await PPCSettings.getSettings()
    const rate     = settings.basePPCValue

    // ✅ FIFO: All commissions oldest first for withdrawal deduction
    const allCommissions = await Commission.find({ toUser: user._id })
      .populate("fromUser", "name role")
      .populate("toUser",   "name role")
      .populate("orderId",  "items total createdAt")
      .sort({ createdAt: 1 })   // oldest first → FIFO
      .lean()

    // Deduct withdrawn PPC from oldest commissions first
    const totalWithdrawn = user.totalWithdrawn || 0
    let toDeduct = totalWithdrawn

    const processedCommissions = allCommissions.map(c => {
      const earned = c.ppcCount || 0
      if (toDeduct <= 0) {
        return { ...c, remainingPPC: earned }
      }
      if (earned <= toDeduct) {
        toDeduct -= earned
        return { ...c, remainingPPC: 0 }   // fully consumed by withdrawal
      }
      const remaining = earned - toDeduct
      toDeduct = 0
      return { ...c, remainingPPC: remaining }
    })

    // Show for history — latest first, only ones with remaining > 0
    const activeHistory = processedCommissions
      .filter(c => c.remainingPPC > 0)
      .reverse()   // latest first for display

    // ✅ For ALL commissions — dynamically fill chainInfo names from fromUser's tree
    for (const h of activeHistory) {
      if (!h.chainInfo) h.chainInfo = {}
      
      const fromUserId = h.fromUser?._id || h.fromUser
      if (!fromUserId) continue

      // fromUser IS the seller who placed the order — get full chain from them
      const fromUserDoc = await User.findById(fromUserId).select("_id name role parentId")
      if (!fromUserDoc) continue

      // directSeller = fromUser itself (agar seller) ya upar ka seller (agar user order)
      let directSellerName = ""
      let directSellerId   = null

      // ✅ FIX: Detect user order from fromUser's role — schema field missing hone par bhi kaam kare
      const isUserOrd = h.isUserOrder || h.chainInfo?.isUserOrder || fromUserDoc.role === "user"

      if (isUserOrd) {
        // User order: fromUser = user, directSeller = fromUser's nearest seller parent
        const ds = await findAncestorByRole(fromUserDoc.parentId, "seller")
        // ✅ NEVER use user's name as directSellerName — only seller's name
        directSellerName = ds?.name || ""
        directSellerId   = ds?._id  || null
        // If still no seller found, try fromUser itself if it's a seller
        if (!directSellerName && fromUserDoc.role === "seller") {
          directSellerName = fromUserDoc.name || ""
          directSellerId   = fromUserDoc._id
        }
      } else {
        // Seller order: fromUser = the direct seller
        directSellerName = fromUserDoc.name || ""
        directSellerId   = fromUserDoc._id
      }

      // Parent seller = seller above directSeller
      const directSellerDoc = directSellerId
        ? await User.findById(directSellerId).select("_id name parentId role")
        : null
      const parentSeller = directSellerDoc?.parentId
        ? await findAncestorByRole(directSellerDoc.parentId, "seller")
        : null
      const distributor = directSellerDoc?.parentId
        ? await findAncestorByRole(directSellerDoc.parentId, "distributor")
        : null

      // Always set names (override empty ones)
      h.chainInfo.directSellerName = directSellerName
      h.chainInfo.parentSellerName = parentSeller?.name || ""
      h.chainInfo.distributorName  = distributor?.name  || ""
    }

    const response = {
      name:           user.name,
      role:           user.role,
      totalPPCEarned: user.totalPPCEarned || 0,
      totalWithdrawn: user.totalWithdrawn  || 0,
      currentPPCRate: rate,
      distributionRates: settings.distributionRates,
      history: activeHistory.map(h => ({
        ...h,
        ppcCount:        h.ppcCount || 0,
        remainingPPC:    h.remainingPPC,
        rupeeValue:      h.rupeeValue || 0,
        positionType:    h.positionType || "direct",
        percentageShare: h.percentageShare || 50,
        isUserOrder:     h.isUserOrder || h.chainInfo?.isUserOrder || (h.fromUser?.role === "user") || false,
        toUserName:      h.toUser?.name || "",   // ✅ "You" ka actual naam
        chainInfo: {
          directSellerName: h.chainInfo?.directSellerName || "",
          distributorName:  h.chainInfo?.distributorName  || "",
          parentSellerName: h.chainInfo?.parentSellerName || "",
          isUserOrder:      h.chainInfo?.isUserOrder      || false,
        },
        walletLabel: h.walletType === "userWallet"           ? "User Wallet (50%)"
                   : h.walletType === "sellerWalletAsSeller" ? "Seller Wallet (25%)"
                   : h.walletType === "sellerWallet"         ? "Distributor-Seller Wallet"
                   : h.walletType,
        earnedAt: h.createdAt,
      }))
    }

    /* ─── DISTRIBUTOR WALLETS ─── */
    if (user.role === "distributor") {
      const distCommissions = allCommissions.filter(h => h.walletType === "sellerWallet")
      const totalDistPPC    = distCommissions.reduce((s, h) => s + (h.ppcCount || 0), 0)
      const weightedDistPct = distCommissions.reduce((s, h) => s + (h.percentageShare || 50) * (h.ppcCount || 0), 0)
      const avgDistPct      = totalDistPPC > 0 ? weightedDistPct / totalDistPPC : 50

      // Level up thresholds from settings
      const thresholds   = settings.levelUpThresholds || { level1:100, level2:500, level3:1000, level4:5000 }
      const levelNames   = settings.levelNames || {
        level0:"Distributor", level1:"Senior Distributor",
        level2:"Gold Distributor", level3:"Platinum Distributor", level4:"Diamond Distributor"
      }
      // ✅ Admin-controlled rewards per level
      const levelRewards = settings.levelRewards || {
        level1: "🎁 ₹500 bonus credit",
        level2: "🎁 ₹1500 bonus credit",
        level3: "🎁 ₹3000 + free kit",
        level4: "🎁 ₹10000 + trip",
      }
      const distPPC = user.distributorWallet || 0

      // Determine current level
      let currentLevel = 0
      if (distPPC >= (thresholds.level4 || 5000))      currentLevel = 4
      else if (distPPC >= (thresholds.level3 || 1000)) currentLevel = 3
      else if (distPPC >= (thresholds.level2 || 500))  currentLevel = 2
      else if (distPPC >= (thresholds.level1 || 100))  currentLevel = 1

      const nextLevel     = currentLevel < 4 ? currentLevel + 1 : null
      const nextThreshold = nextLevel ? (thresholds[`level${nextLevel}`] || 0) : null
      const prevThreshold = currentLevel > 0 ? (thresholds[`level${currentLevel}`] || 0) : 0
      const progress      = nextThreshold
        ? Math.min(100, Math.round(((distPPC - prevThreshold) / (nextThreshold - prevThreshold)) * 100))
        : 100

      response.wallets = {
        distributorWallet: {
          label:            "Distributor Wallet",
          ppcCount:         distPPC,
          withdrawable:     false,
          note:             "Level progression ke liye — withdraw nahi ho sakta",
          // ✅ Level info
          currentLevel,
          currentLevelName: levelNames[`level${currentLevel}`] || "Distributor",
          nextLevelName:    nextLevel ? (levelNames[`level${nextLevel}`] || "") : null,
          nextThreshold,
          prevThreshold,
          progress,
          thresholds,
          levelNames,
          levelRewards,   // ✅ Admin-controlled rewards per level
        },
        sellerWallet: {
          label:          "Seller Wallet",
          ppcCount:       user.sellerWallet || 0,
          percentage:     Math.round(avgDistPct),
          estimatedValue: (user.sellerWallet || 0) * rate * (avgDistPct / 100),
          withdrawable:   true,
          note:           "Seller network se aaya — withdraw ho sakta hai"
        },
      }
      // ✅ Distributor's OWN Direct Seller Wallet level data (separate from Seller role's)
      response.sellerLevelUpThresholds = settings.distSellerLevelUpThresholds || { level1:50, level2:200, level3:500, level4:2000 }
      response.sellerLevelNames        = settings.distSellerLevelNames        || { level0:"Seller", level1:"Silver Seller", level2:"Gold Seller", level3:"Platinum Seller", level4:"Diamond Seller" }
      response.sellerLevelRewards      = settings.distSellerLevelRewards      || { level1:"🎁 ₹250 bonus credit", level2:"🎁 ₹750 bonus credit", level3:"🎁 ₹1500 + free kit", level4:"🎁 ₹5000 + trip" }
    }

    /* ─── SELLER WALLETS ─── */
    if (user.role === "seller") {
      // ✅ Actual % from commission history per wallet type
      const userWalletComm   = allCommissions.filter(h => h.walletType === "userWallet")
      const sellerWalletComm = allCommissions.filter(h => h.walletType === "sellerWalletAsSeller")

      const calcAvgPct = (comms) => {
        const totalP = comms.reduce((s,h) => s + (h.ppcCount||0), 0)
        const weightP= comms.reduce((s,h) => s + (h.percentageShare||50)*(h.ppcCount||0), 0)
        return totalP > 0 ? weightP / totalP : 50
      }

      const avgUserPct   = calcAvgPct(userWalletComm)
      const avgSellerPct = calcAvgPct(sellerWalletComm)

      response.wallets = {
        userWallet: {
          label:          "User Wallet",
          ppcCount:       user.userWalletAsSeller || 0,
          percentage:     Math.round(avgUserPct),
          estimatedValue: (user.userWalletAsSeller || 0) * rate * (avgUserPct / 100),
          withdrawable:   true,
          note:           "User ki sales se mila (50% share)"
        },
        sellerWallet: {
          label:          "Seller Wallet",
          ppcCount:       user.sellerWalletAsSeller || 0,
          percentage:     Math.round(avgSellerPct),
          estimatedValue: (user.sellerWalletAsSeller || 0) * rate * (avgSellerPct / 100),
          withdrawable:   true,
          note:           "Neeche wale seller ki sales se mila (25% share)"
        },
      }
      const totalSellerPPC = (user.userWalletAsSeller || 0) + (user.sellerWalletAsSeller || 0)
      const thresholds = settings.sellerLevelUpThresholds || { level1:50, level2:200, level3:500, level4:2000 }
      const levelNames = settings.sellerLevelNames || { level0:"Direct Seller", level1:"Silver Seller", level2:"Gold Seller", level3:"Platinum Seller", level4:"Diamond Seller" }
      const levelRewards = settings.sellerLevelRewards || { level1:"🎁 ₹250 bonus credit", level2:"🎁 ₹750 bonus credit", level3:"🎁 ₹1500 + free kit", level4:"🎁 ₹5000 + trip" }

      let currentLevel = 0
      if (totalSellerPPC >= (thresholds.level4 || 2000))      currentLevel = 4
      else if (totalSellerPPC >= (thresholds.level3 || 500))  currentLevel = 3
      else if (totalSellerPPC >= (thresholds.level2 || 200))  currentLevel = 2
      else if (totalSellerPPC >= (thresholds.level1 || 50))   currentLevel = 1

      const nextLevel     = currentLevel < 4 ? currentLevel + 1 : null
      const nextThreshold = nextLevel ? (thresholds[`level${nextLevel}`] || 0) : null
      const prevThreshold = currentLevel > 0 ? (thresholds[`level${currentLevel}`] || 0) : 0
      const progress      = nextThreshold
        ? Math.min(100, Math.round(((totalSellerPPC - prevThreshold) / (nextThreshold - prevThreshold)) * 100))
        : 100

      response.totalSellerPPC = totalSellerPPC
      response.unifiedSellerReward = {
        totalPPC: totalSellerPPC,
        currentLevel,
        currentLevelName: levelNames[`level${currentLevel}`] || "Direct Seller",
        nextLevelName: nextLevel ? (levelNames[`level${nextLevel}`] || "") : null,
        nextThreshold,
        prevThreshold,
        progress,
        thresholds,
        levelNames,
        levelRewards
      }

      // ✅ Seller's OWN Direct Seller Wallet level data (admin PPC settings)
      response.sellerLevelUpThresholds = thresholds
      response.sellerLevelNames        = levelNames
      response.sellerLevelRewards      = levelRewards
      // Backward compatibility
      response.userWalletLevelUpThresholds = thresholds
      response.userWalletLevelNames        = levelNames
      response.userWalletLevelRewards      = levelRewards
    }

    res.json(response)

  } catch (err) {
    console.error("Get wallet error:", err)
    res.status(500).json({ message: "Failed to load wallet" })
  }
}

/* ── Helpers for wallet value calculation ── */
function remainingPct(user, role) {
  // We don't know dynamically here, so just show "25-50%"
  return 25  // will show range in UI
}

function calcValue(ppcCount, rate, user, role) {
  // Distributor gets 25% when parent seller exists, 50% otherwise
  // We show 25% as minimum (safe lower bound)
  return (ppcCount || 0) * rate * 0.25
}
