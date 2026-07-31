import express from "express"
import protect from "../middleware/auth.js"
import Commission from "./commission.model.js"

/* ⭐ EXISTING IMPORT (UNCHANGED) */
import {
  saveCommissionLevels,
  getCommissionLevels
} from "./commissionLevels.controller.js"

/* ⭐ ROUTER CREATE */
const router = express.Router()

console.log("✅ commission.routes.js loaded")

/* ⭐ OPTIONAL ADMIN CHECK (SAFE) */
const adminOnly = (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      console.log("❌ Non-admin tried to access commission levels")
      return res.status(403).json({ message: "Admins only" })
    }
    next()
  } catch (err) {
    console.error("❌ Admin check error:", err.message)
    res.status(500).json({ message: err.message })
  }
}

/* ⭐ SAFE USER CHECK */
const safeUserCheck = (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      console.log("❌ Unauthorized request")
      return res.status(401).json({ message: "Unauthorized" })
    }
    next()
  } catch (err) {
    console.error("❌ User check error:", err.message)
    res.status(500).json({ message: err.message })
  }
}

/* =====================================================
   TEST ROUTE
===================================================== */
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "Commission routes working ✅" })
})

/* ===============================
   GET LEVELS
=============================== */
router.get("/levels", protect, adminOnly, async (req, res, next) => {
  try {
    console.log("📥 Fetching commission levels by:", req.user?.id)
    await getCommissionLevels(req, res)
  } catch (err) {
    console.error("❌ Route get levels error:", err.message)
    next(err)
  }
})

/* ===============================
   SAVE LEVELS
=============================== */
router.post("/levels", protect, adminOnly, async (req, res, next) => {
  try {
    console.log("💾 Saving commission levels by:", req.user?.id)
    await saveCommissionLevels(req, res)
  } catch (err) {
    console.error("❌ Route save levels error:", err.message)
    next(err)
  }
})

/* =====================================================
   ⭐ USER → My Commission
===================================================== */
router.get("/mine", protect, safeUserCheck, async (req, res) => {
  try {

    console.log("💰 Commission Mine Request By:", req.user?.id)

    const list = await Commission.find({ toUser: req.user.id })
      .populate("fromUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })

    res.json(list)

  } catch (err) {
    console.error("❌ GET /commission/mine ERROR:", err.message)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ⭐ ADMIN → All Commission
===================================================== */
router.get("/all", protect, safeUserCheck, async (req, res) => {
  try {

    console.log("💰 Commission ALL Request By:", req.user?.id)

    /* 🔥 ONLY ADMIN ALLOWED */
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admins only" })
    }

    const list = await Commission.find()
      .populate("fromUser", "name email role")
      .populate("toUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })

    res.json(list)

  } catch (err) {
    console.error("❌ GET /commission/all ERROR:", err.message)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ⭐ OPTIONAL → ADMIN FILTER BY USER
===================================================== */
router.get("/user/:id", protect, safeUserCheck, async (req, res) => {
  try {

    console.log("💰 Commission Filter For User:", req.params.id)

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admins only" })
    }

    const list = await Commission.find({
      toUser: req.params.id
    })
      .populate("fromUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })

    res.json(list)

  } catch (err) {
    console.error("❌ GET /commission/user ERROR:", err.message)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ⭐ OPTIONAL → STATS SUMMARY
===================================================== */
router.get("/stats", protect, safeUserCheck, async (req, res) => {
  try {

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admins only" })
    }

    const total = await Commission.aggregate([
      {
        $group: {
          _id: "$toUser",
          total: { $sum: "$amount" }
        }
      }
    ])

    res.json(total)

  } catch (err) {
    console.error("❌ GET /commission/stats ERROR:", err.message)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ⭐ HEALTH CHECK FOR MLM DEBUG
===================================================== */
router.get("/health", async (req, res) => {
  res.json({
    ok: true,
    msg: "Commission module healthy ✅",
    time: new Date()
  })
})

/* ⭐ FINAL EXPORT */
export default router