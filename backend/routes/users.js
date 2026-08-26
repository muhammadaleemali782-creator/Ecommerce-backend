import express from "express"
import bcrypt from "bcryptjs"
import auth from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import User from "../models/User.js"
import Commission from "../commission/commission.model.js"

const router = express.Router()

console.log("✅ users.routes.js loaded")

/*
=====================================================
SAVE FCM TOKEN — Android app login/token-refresh pe call karta hai
=====================================================
*/
router.post("/fcm-token", auth, async (req, res) => {
  try {
    const { token } = req.body
    if (!token) {
      return res.status(400).json({ success: false, message: "Token required" })
    }
    await User.findByIdAndUpdate(req.user.id, { fcmToken: token })
    res.json({ success: true })
  } catch (err) {
    console.error("❌ Save FCM token error:", err.message)
    res.status(500).json({ success: false, message: "Server error" })
  }
})


/*
=====================================================
CREATE SELLER
=====================================================
*/
router.post(
  "/create-seller",
  auth,
  allowRoles("admin", "distributor"),
  async (req, res) => {
    try {
      console.log("👤 Create seller by:", req.user?.id)

      const { name, email, password } = req.body

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "All fields are required"
        })
      }

      const cleanEmail = email.trim().toLowerCase()

      const existingUser = await User.findOne({ email: cleanEmail })
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Email already exists"
        })
      }

      const hash = await bcrypt.hash(password, 10)

      const seller = await User.create({
        name: name.trim(),
        email: cleanEmail,
        password: hash,
        role: "seller",
        parentId: req.user.id,
        coinBalance: 0,
        walletBalance: 0
      })

      console.log("✅ Seller created:", seller.email)

      res.status(201).json({
        success: true,
        seller
      })

    } catch (err) {
      console.error("❌ Create seller error:", err.message)
      res.status(500).json({
        success: false,
        message: "Server error"
      })
    }
  }
)

/*
=====================================================
GET USER NETWORK TREE  ⭐ FINAL FIX
=====================================================
*/
router.get("/tree", auth, async (req, res) => {
  try {

    console.log("🌐 Network tree requested by:", req.user?.id, req.user?.role)

    const users = await User.find({}, "name role parentId").lean()

    const buildTree = (pid) =>
      users
        .filter(u => String(u.parentId) === String(pid))
        .map(u => ({
          id: String(u._id),
          name: u.name,
          role: u.role,
          children: buildTree(String(u._id))
        }))

    /* ================= ADMIN ================= */
    if (req.user.role === "admin") {
      console.log("👉 Admin full tree")
      const adminUser = users.find(u => u.role === "admin")
      const adminId = adminUser ? String(adminUser._id) : null
      const nonAdminIds = new Set(users.filter(u => u.role !== "admin").map(u => String(u._id)))
      const topLevel = users.filter(u => {
        if (u.role === "admin") return false
        const pid = u.parentId ? String(u.parentId) : null
        if (!pid || pid === "null" || pid === "") return true
        if (adminId && pid === adminId) return true
        if (!nonAdminIds.has(pid)) return true
        return false
      }).map(u => ({
        id: String(u._id),
        name: u.name,
        role: u.role,
        children: buildTree(String(u._id))
      }))
      console.log("🌳 Admin topLevel:", topLevel.length)
      return res.json({
        success: true,
        tree: [{ id: adminId || "admin", name: adminUser?.name || "Admin", role: "admin", children: topLevel }]
      })
    }

    /* ================= DISTRIBUTOR / SELLER ================= */

    const me = users.find(
      u => String(u._id) === String(req.user.id)
    )

    if (!me) {
      console.log("❌ User not found in DB")
      return res.json({ success: true, tree: [] })
    }

    const myTree = {
      id: String(me._id),
      name: me.name,
      role: me.role,
      children: buildTree(String(me._id))
    }

    console.log("👉 Returning ONLY my tree")

    return res.json({
      success: true,
      tree: [myTree]
    })

  } catch (err) {
    console.error("❌ Tree fetch error:", err.message)
    res.status(500).json({
      success: false,
      message: "Failed to load tree"
    })
  }
})

/*
=====================================================
GET MY WALLET
=====================================================
*/
router.get("/wallet/me", auth, async (req, res) => {
  try {

    console.log("🪙 Wallet request by:", req.user?.id)

    const user = await User.findById(req.user.id)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      })
    }

    const history = await Commission.find({
      toUser: user._id
    })
      .populate("fromUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })
      .limit(50)

    res.json({
      success: true,
      coinBalance: user.coinBalance || 0,
      walletBalance: user.walletBalance || 0,
      totalCommissionEarned: user.totalCommissionEarned || 0,
      totalCoinEarned: user.totalCoinEarned || 0,
      history
    })

  } catch (err) {
      console.error("❌ Wallet API error:", err.message)
      res.status(500).json({
        success: false,
        message: "Failed to load wallet"
      })
  }
})

/*
=====================================================
ADMIN → ALL USERS WALLET
=====================================================
*/
router.get(
  "/wallet/all",
  auth,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const users = await User.find().select(
        "name email role coinBalance walletBalance totalCommissionEarned totalCoinEarned"
      )

      res.json({
        success: true,
        users
      })
    } catch (err) {
      console.error("❌ Wallet all error:", err.message)
      res.status(500).json({
        success: false,
        message: "Failed to load wallets"
      })
    }
  }
)

/* =====================================================
   ⭐ GET MY PROFILE
===================================================== */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("name fullName email role phone address parentId coinBalance walletBalance createdAt")
      .populate("parentId", "name role")
      .lean()

    if (!user) return res.status(404).json({ msg: "User not found" })

    res.json(user)
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* =====================================================
   ⭐ UPDATE MY PROFILE
===================================================== */
router.put("/profile/update", auth, async (req, res) => {
  try {
    const { fullName, phone, address } = req.body

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fullName: fullName?.trim() || "", phone: phone?.trim() || "", address: address?.trim() || "" },
      { new: true }
    ).select("name fullName email role phone address")

    if (!user) return res.status(404).json({ msg: "User not found" })

    res.json({ success: true, user })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* =====================================================
   ⭐ ADMIN UPDATE ANY USER PROFILE (FullName, Phone, Address, Name)
===================================================== */
router.put("/admin/update/:id", auth, allowRoles("admin"), async (req, res) => {
  try {
    const { fullName, phone, address, name } = req.body
    const updateData = {}
    if (fullName !== undefined) updateData.fullName = fullName.trim()
    if (phone !== undefined)    updateData.phone    = phone.trim()
    if (address !== undefined)  updateData.address  = address.trim()
    if (name !== undefined && name.trim()) updateData.name = name.trim()

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select("name fullName email role phone address")

    if (!user) return res.status(404).json({ msg: "User not found" })
    res.json({ success: true, user })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* =====================================================
   ⭐ MY DOWNLINE FLAT — for order on behalf of
   Returns all users below the logged-in seller/distributor
===================================================== */
router.get("/my-downline", auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select("name role")
    if (!me) return res.status(404).json({ msg: "User not found" })

    // Recursive function to get all children
    const getAllChildren = async (parentId, level = 1) => {
      const children = await User.find({ parentId, isDeleted: { $ne: true } })
        .select("name role _id parentId phone")
      const result = []
      for (const child of children) {
        result.push({ ...child.toObject(), level })
        const nested = await getAllChildren(child._id, level + 1)
        result.push(...nested)
      }
      return result
    }

    const downline = await getAllChildren(req.user.id)
    res.json({ me: { _id: me._id, name: me.name, role: me.role }, downline })
  } catch (err) {
    console.error("Downline fetch error:", err)
    res.status(500).json({ msg: "Failed" })
  }
})

export default router