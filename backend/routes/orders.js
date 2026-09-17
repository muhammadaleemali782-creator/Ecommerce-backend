import express from "express"
import mongoose from "mongoose"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import Order from "../models/Order.js"
import User from "../models/User.js"
import Commission from "../commission/commission.model.js"
import { createPPCCommissionFromOrder } from "../commission/ppcCommission.controller.js"
import {
  notifyNewOrder,
  notifyDistApproved,
  notifyConfirmed,
  notifyRejected,
} from "../utils/notifHelper.js"

const router = express.Router()

/* ── Helper: nearest distributor ── */
const findDistributorId = async (userDoc) => {
  if (!userDoc) return null
  if (userDoc.role === "distributor") return userDoc._id
  if (!userDoc.parentId) return null
  const parent = await User.findById(userDoc.parentId).select("role parentId isDeleted")
  if (!parent || parent.isDeleted) return null
  return findDistributorId(parent)
}

/* ── Helper: tree mein upar walk karo jab tak seller na mile ── */
const findNearestSeller = async (userId, visited = new Set()) => {
  if (!userId || visited.has(String(userId))) return null
  visited.add(String(userId))
  const user = await User.findById(userId).select("_id role parentId isDeleted")
  if (!user || user.isDeleted) return null
  if (user.role === "seller") return user
  if (user.role === "distributor" || user.role === "admin") return null // stop
  // user/other role → go up
  return findNearestSeller(user.parentId, visited)
}

/* ── Helper: trigger PPC + Sales after admin final confirm ── */
const triggerFinalConfirm = async (order) => {
  // PPC distribute
  try { await createPPCCommissionFromOrder(order) }
  catch(e) { console.error("PPC err:", e.message) }

  // Seller sales update
  try {
    const seller = await User.findById(order.sellerId?._id || order.sellerId)
    if (seller) {
      seller.sales = (seller.sales || 0) + (order.total || 0)
      await seller.save()
    }
  } catch(e) { console.error("Sales err:", e.message) }
}

/* ═══════════════════════════════════════════════
   POST /orders — Order create karo
═══════════════════════════════════════════════ */
router.post("/", protect, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ msg: "Unauthorized" })
    const me = await User.findById(req.user.id)
    if (!me) return res.status(404).json({ msg: "User not found" })

    const { onBehalfOfId: rawBehalfId, ...orderBody } = req.body
    let behalfUser = null
    if (rawBehalfId) behalfUser = await User.findById(rawBehalfId).select("name role")

    // ✅ BLOCK: Distributor apne liye order nahi laga sakta (bina selection ke)
    if (me.role === "distributor" && !behalfUser) {
      return res.status(403).json({
        msg: "Distributor apne liye order nahi laga sakta — kisi seller ya user ko select karo."
      })
    }

    // ✅ BLOCK: Distributor kisi doosre distributor ke liye order nahi laga sakta
    if (me.role === "distributor" && behalfUser && behalfUser.role === "distributor") {
      return res.status(403).json({
        msg: "Distributor ke liye order nahi lagaya ja sakta — sirf seller ya user ke liye laga sakte hain."
      })
    }

    let sellerId = me._id
    let userId   = null

    if (me.role === "user") {
      userId = me._id
      const nearestSeller = await findNearestSeller(me.parentId)
      if (nearestSeller) {
        sellerId = nearestSeller._id
      } else {
        sellerId = me.parentId || me._id
      }
    } else if (behalfUser) {
      // ✅ FIX: Behalf order — sellerId aur userId behalfUser ke role se decide karo
      if (behalfUser.role === "user") {
        // Distributor/seller ne USER ki taraf se order lagaya
        userId   = behalfUser._id
        // behalfUser (user) ke upar wala nearest seller = sellerId
        const behalfUserFull = await User.findById(behalfUser._id).select("parentId")
        const nearestSeller = await findNearestSeller(behalfUserFull?.parentId)
        sellerId = nearestSeller?._id || behalfUserFull?.parentId || behalfUser._id
      } else if (behalfUser.role === "seller") {
        // Distributor ne SELLER ki taraf se order lagaya
        userId   = null          // koi user nahi — direct seller order hai
        sellerId = behalfUser._id  // behalfUser khud seller hai
      } else {
        // Fallback
        userId   = behalfUser._id
        sellerId = me._id
      }
    }

    const nearestDistId = await findDistributorId(me)

    const behalfFields = behalfUser ? {
      onBehalfOfId: behalfUser._id, onBehalfOfName: behalfUser.name, onBehalfOfRole: behalfUser.role,
      placedById: me._id, placedByName: me.name, placedByRole: me.role,
    } : { placedById: me._id, placedByName: me.name, placedByRole: me.role }

    const order = await Order.create({
      sellerId, userId,
      nearestSellerId: null,
      distributorId:   nearestDistId || null,
      status:          "pending",
      ...behalfFields, ...orderBody
    })

    console.log("✅ ORDER CREATED:", order._id, "| dist:", nearestDistId)

    // 🔔 Notifications — distributor + admins ko batao
    try {
      const distributor = nearestDistId ? await User.findById(nearestDistId).select("name") : null
      const admins      = await User.find({ role: "admin", isDeleted: { $ne: true } }).select("_id")
      const adminIds    = admins.map(a => a._id)
      await notifyNewOrder({ order, seller: me, distributor, adminIds })
    } catch (ne) { console.error("Notif error:", ne.message) }

    const populatedOrder = await Order.findById(order._id)
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")

    res.json(populatedOrder || order)
  } catch (err) {
    console.error("❌ ORDER ERROR:", err)
    res.status(500).json({ msg: "Order creation failed" })
  }
})

/* ═══════════════════════════════════════════════
   GET /orders/pending — Distributor ke pending orders
   (status = "pending" only)
═══════════════════════════════════════════════ */
router.get("/pending", protect, allowRoles("distributor"), async (req, res) => {
  try {
    const orders = await Order.find({ distributorId: req.user.id, status: "pending" })
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")
      .sort({ createdAt: -1 })
    res.json(orders)
  } catch (err) { res.status(500).json({ msg: err.message }) }
})

/* ═══════════════════════════════════════════════
   PUT /orders/dist-approve/:id
   ⭐ STAGE 1: Distributor approve kare
   status: pending → dist_approved
   Body: { note, noteVisible }
═══════════════════════════════════════════════ */
router.put("/dist-approve/:id", protect, allowRoles("distributor"), async (req, res) => {
  try {
    const { note = "", noteVisible = false } = req.body

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ msg: "Order not found" })

    const isOwner = String(order.distributorId) === String(req.user.id)
                 || String(order.placedById)    === String(req.user.id)
    if (!isOwner) return res.status(403).json({ msg: "Unauthorized" })

    if (order.status !== "pending") {
      return res.status(400).json({ msg: "Order already processed" })
    }

    // ✅ Stage 1 complete — waiting for admin
    order.status               = "dist_approved"
    order.distributorApproved  = true
    order.distributorApprovedAt = new Date()
    order.distributorNote      = note.trim()
    order.distributorNoteVisible = noteVisible   // ⭐ seller ko dikhana hai ya nahi
    order.adminBypassedDistributor = false
    await order.save()

    // ⚠️ NOTE: PPC/Sales trigger NAHI hoga — sirf admin final confirm pe hoga

    // 🔔 Notification — seller + admins ko batao
    try {
      const distUser = await User.findById(req.user.id).select("name")
      const admins   = await User.find({ role: "admin", isDeleted: { $ne: true } }).select("_id")
      const adminIds = admins.map(a => a._id)
      await notifyDistApproved({ order, distributor: distUser, adminIds })
    } catch (ne) { console.error("Notif error:", ne.message) }

    res.json({ success: true, order, message: "Stage 1 complete — Ab Admin final approve karega" })
  } catch (err) {
    console.error("Dist approve error:", err)
    res.status(500).json({ msg: err.message })
  }
})

/* ═══════════════════════════════════════════════
   PUT /orders/admin-approve/:id
   ⭐ STAGE 2: Admin FINAL approve kare
   Kaam karta hai chahe dist approve kiya ho ya na kiya ho
   status: any → confirmed
   Body: { note, noteVisible }
   ⭐ Yahan PPC + Sales trigger hoti hai
═══════════════════════════════════════════════ */
router.put("/admin-approve/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { note = "", noteVisible = false } = req.body

    const order = await Order.findById(req.params.id)
      .populate("sellerId", "name email role sales")
      .populate("distributorId", "name")

    if (!order) return res.status(404).json({ msg: "Order not found" })
    if (order.status === "confirmed") return res.status(400).json({ msg: "Already confirmed" })
    if (order.status === "rejected")  return res.status(400).json({ msg: "Rejected order approve nahi ho sakta" })

    // ✅ FINAL CONFIRM — PPC + Sales yahan trigger hongi
    order.status          = "confirmed"
    order.confirmedAt     = new Date()
    order.adminApproved   = true
    order.adminApprovedAt = new Date()
    order.adminNote       = note.trim()
    order.adminNoteVisible = noteVisible    // ⭐ seller ko dikhana hai ya nahi
    order.approvedByAdmin = true

    // Agar distributor ne pehle approve nahi kiya tha, to admin direct approve mark karo
    if (!order.distributorApproved) {
      order.adminBypassedDistributor = true
      // order.distributorApproved false hi rahega taki pata chale ki distributor ne approve nahi kiya tha
    } else {
      order.adminBypassedDistributor = false
    }

    await order.save()

    // ⭐⭐ YAHAN PPC + SALES TRIGGER HOTI HAIN ⭐⭐
    await triggerFinalConfirm(order)

    // 🔔 Notification — seller + distributor ko batao
    try {
      await notifyConfirmed({ order })
    } catch (ne) { console.error("Notif error:", ne.message) }

    console.log("✅ ADMIN FINAL APPROVED:", order._id, "| PPC distributed")
    res.json({ success: true, order, message: "✅ Final confirm — PPC distribute ho gayi, Sales update ho gayi" })
  } catch (err) {
    console.error("Admin approve error:", err)
    res.status(500).json({ msg: err.message })
  }
})

/* ═══════════════════════════════════════════════
   PUT /orders/change-seller/:id
   ⭐ Admin can change the seller of ANY order (pending, dist_approved, confirmed, rejected)
   Body: { newSellerId } (ObjectId or User name/ID like "DB001/DS005")
   ⭐ If confirmed:
      - Reverts old PPC commissions and old seller sales
      - Re-distributes PPC and sales to new seller & their chain
      - Updates order.sellerId, placedBy / onBehalfOf, and distributorId
═══════════════════════════════════════════════ */
router.put("/change-seller/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { newSellerId } = req.body
    if (!newSellerId) {
      return res.status(400).json({ msg: "Naya seller ID / selection zaroori hai" })
    }

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ msg: "Order not found" })

    // Find new seller by _id or name/ID (e.g. DB001/DS005) or email
    const trimmedId = String(newSellerId).trim()
    const query = mongoose.isValidObjectId(trimmedId)
      ? { $or: [{ _id: trimmedId }, { name: trimmedId }, { email: trimmedId.toLowerCase() }] }
      : { $or: [{ name: trimmedId }, { email: trimmedId.toLowerCase() }] }

    const newSeller = await User.findOne(query)
    if (!newSeller) {
      return res.status(404).json({ msg: `Seller '${trimmedId}' nahi mila. Kripya valid ID ya naam dalein.` })
    }

    if (newSeller.isDeleted) {
      return res.status(400).json({ msg: "Yeh seller account deleted hai." })
    }

    const oldSellerId = order.sellerId

    if (String(newSeller._id) === String(oldSellerId)) {
      return res.status(400).json({ msg: "Order pehle se hi is seller ke paas hai." })
    }

    // ── 1. IF ORDER WAS ALREADY CONFIRMED: REVERT OLD COMMISSIONS & SALES ──
    if (order.status === "confirmed") {
      const oldCommissions = await Commission.find({ orderId: order._id })
      for (const comm of oldCommissions) {
        if (comm.toUser) {
          const recipient = await User.findById(comm.toUser)
          if (recipient) {
            const ppc = Number(comm.ppcCount || 0)
            if (comm.walletType === "userWallet") {
              recipient.userWalletAsSeller = Math.max(0, (recipient.userWalletAsSeller || 0) - ppc)
            } else if (comm.walletType === "sellerWalletAsSeller") {
              recipient.sellerWalletAsSeller = Math.max(0, (recipient.sellerWalletAsSeller || 0) - ppc)
            } else if (comm.walletType === "sellerWallet") {
              recipient.sellerWallet = Math.max(0, (recipient.sellerWallet || 0) - ppc)
            }
            recipient.totalPPCEarned = Math.max(0, (recipient.totalPPCEarned || 0) - ppc)
            await recipient.save()
          }
        }
      }

      // Revert sales from old seller
      if (oldSellerId) {
        const oldSeller = await User.findById(oldSellerId)
        if (oldSeller) {
          oldSeller.sales = Math.max(0, (oldSeller.sales || 0) - (order.total || 0))
          await oldSeller.save()
        }
      }

      // Delete old commissions so createPPCCommissionFromOrder can regenerate for new seller
      await Commission.deleteMany({ orderId: order._id })
    }

    // ── 2. UPDATE ORDER SELLER AND HIERARCHY ──
    order.sellerId = newSeller._id

    // If placedById was old seller or placedBy was seller role, update to new seller
    if (!order.placedById || String(order.placedById) === String(oldSellerId) || order.placedByRole === "seller") {
      order.placedById   = newSeller._id
      order.placedByName = newSeller.name
      order.placedByRole = newSeller.role
    }

    // If onBehalfOfId was old seller, update to new seller
    if (String(order.onBehalfOfId) === String(oldSellerId) || order.onBehalfOfRole === "seller") {
      order.onBehalfOfId   = newSeller._id
      order.onBehalfOfName = newSeller.name
      order.onBehalfOfRole = newSeller.role
    }

    // Update distributor for new seller
    const newDistId = await findDistributorId(newSeller)
    if (newDistId) {
      order.distributorId = newDistId
    }

    await order.save()

    // ── 3. IF CONFIRMED: RE-DISTRIBUTE PPC & SALES TO NEW SELLER ──
    if (order.status === "confirmed") {
      const freshOrder = await Order.findById(order._id)
        .populate("sellerId")
        .populate("distributorId")
        .populate("userId")
      await triggerFinalConfirm(freshOrder)
    }

    const updatedOrder = await Order.findById(order._id)
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")

    console.log(`✅ Order ${order._id} seller changed from ${oldSellerId} to ${newSeller._id} (${newSeller.name})`)

    res.json({
      success: true,
      order: updatedOrder,
      message: `Seller successfully changed to ${newSeller.fullName || newSeller.name} (${newSeller.name}). PPC and Sales transferred.`
    })
  } catch (err) {
    console.error("Change seller error:", err)
    res.status(500).json({ msg: err.message || "Seller change karne mein error aaya" })
  }
})

/* ═══════════════════════════════════════════════
   PUT /orders/reject/:id
   Distributor ya Admin reject kar sakta hai
   Body: { note, noteVisible }
═══════════════════════════════════════════════ */
router.put("/reject/:id", protect, async (req, res) => {
  try {
    const { note = "", noteVisible = false } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ msg: "Order not found" })

    const isDistributor = req.user.role === "distributor" &&
      (String(order.distributorId) === String(req.user.id) || String(order.placedById) === String(req.user.id))
    const isAdmin = req.user.role === "admin"

    if (!isDistributor && !isAdmin) return res.status(403).json({ msg: "Unauthorized" })
    if (order.status === "confirmed") return res.status(400).json({ msg: "Confirmed order reject nahi hoga" })

    order.status     = "rejected"
    order.rejectedAt = new Date()
    order.rejectedBy = req.user.id

    if (isDistributor) {
      order.distributorRejectedAt   = new Date()
      order.distributorRejectedNote = note.trim()
      order.distributorNote         = note.trim()
      order.distributorNoteVisible  = noteVisible
    } else {
      order.adminNote        = note.trim()
      order.adminNoteVisible = noteVisible
    }

    await order.save()

    // 🔔 Notification — seller ko batao
    try {
      const rejector = await User.findById(req.user.id).select("name role")
      await notifyRejected({
        order,
        rejectorName: rejector?.name || "Admin/Distributor",
        rejectorRole: rejector?.role || req.user.role,
      })
    } catch (ne) { console.error("Notif error:", ne.message) }

    res.json({ success: true, order })
  } catch (err) { res.status(500).json({ msg: err.message }) }
})

/* ═══════════════════════════════════════════════
   GET /orders/distributor — Distributor ke saare orders
   (pending + dist_approved + confirmed + rejected)
═══════════════════════════════════════════════ */
router.get("/distributor", protect, allowRoles("distributor"), async (req, res) => {
  try {
    const orders = await Order.find({ distributorId: req.user.id })
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")
      .sort({ createdAt: -1 })
    res.json(orders)
  } catch (err) { res.status(500).json({ msg: err.message }) }
})

/* ═══════════════════════════════════════════════
   GET /orders/mine — Seller/User orders
   ⭐ Note visibility filter — sirf visible notes dikhao
═══════════════════════════════════════════════ */
router.get("/mine", protect, allowRoles("seller", "user"), async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(req.user.id)
    const rawOrders = await Order.find({
      $or: [
        { placedById:   uid },
        { onBehalfOfId: uid },
        { sellerId:     uid },
        { userId:       uid },
      ]
    })
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")
      .sort({ createdAt: -1 })

    // ⭐ Note visibility filter — agar noteVisible false hai to hide karo
    const orders = rawOrders.map(o => {
      const obj = o.toObject()
      if (!obj.distributorNoteVisible) {
        obj.distributorNote = ""
        obj.distributorRejectedNote = ""
      }
      if (!obj.adminNoteVisible) {
        obj.adminNote = ""
      }
      return obj
    })

    res.json(orders)
  } catch (err) { res.status(500).json({ msg: err.message }) }
})

/* ═══════════════════════════════════════════════
   GET /orders/admin — Admin all orders with all details
═══════════════════════════════════════════════ */
router.get("/admin", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { status } = req.query
    const query = status && status !== "all" ? { status } : {}
    const orders = await Order.find(query)
      .populate("sellerId",      "name fullName email role phone")
      .populate("userId",        "name fullName email role phone")
      .populate("distributorId", "name fullName email role phone")
      .sort({ createdAt: -1 })
      .limit(500)
    res.json(orders)
  } catch (err) { res.status(500).json({ msg: err.message }) }
})


// ✅ GET /orders/team — Seller/Distributor ke downline ke orders
router.get("/team", protect, allowRoles("seller", "distributor"), async (req, res) => {
  try {
    const User = (await import("../models/User.js")).default
    const me = req.user.id

    // Get all downline recursively
    const getAllChildren = async (parentId) => {
      const children = await User.find({ parentId, isDeleted: { $ne: true } }).select("_id name role")
      let result = [...children]
      for (const child of children) {
        const nested = await getAllChildren(child._id)
        result = result.concat(nested)
      }
      return result
    }

    const downline = await getAllChildren(me)
    const dlIds = downline.map(u => u._id)

    if (dlIds.length === 0) return res.json({ orders: [], downline: [] })

    const orders = await Order.find({
      $or: [
        { sellerId: { $in: dlIds } },
        { userId:   { $in: dlIds } },
      ]
    })
    .populate("sellerId", "name role")
    .populate("userId", "name role")
    .sort({ createdAt: -1 })
    .limit(200)

    res.json({ orders, downline })
  } catch (err) {
    console.error("Team orders error:", err)
    res.status(500).json({ msg: err.message })
  }
})

export default router
