import express from "express"
import protect from "../middleware/auth.js"
import Notification from "../models/Notification.js"

const router = express.Router()

/* ════════════════════════════════════════════
   GET /api/notifications
   Meri saari notifications (latest 50)
════════════════════════════════════════════ */
router.get("/", protect, async (req, res) => {
  try {
    const notifs = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    res.json(notifs)
  } catch (err) {
    console.error("Notifications fetch error:", err.message)
    res.status(500).json({ msg: err.message })
  }
})

/* ════════════════════════════════════════════
   GET /api/notifications/unread-count
   Sirf unread count — fast polling ke liye
════════════════════════════════════════════ */
router.get("/unread-count", protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user.id,
      read:   false,
    })
    res.json({ count })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* ════════════════════════════════════════════
   DELETE /api/notifications/:id
   Single notification delete karo
════════════════════════════════════════════ */
router.delete("/:id", protect, async (req, res) => {
  try {
    const notif = await Notification.findOneAndDelete({
      _id:    req.params.id,
      userId: req.user.id, // Sirf apni delete kar sakta hai
    })
    if (!notif) return res.status(404).json({ msg: "Not found" })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* ════════════════════════════════════════════
   DELETE /api/notifications/clear/all
   Saari notifications delete karo (clear)
════════════════════════════════════════════ */
router.delete("/clear/all", protect, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.id })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

/* ════════════════════════════════════════════
   PATCH /api/notifications/mark-read
   Open hone par sab ko read mark karo
════════════════════════════════════════════ */
router.patch("/mark-read", protect, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, read: false },
      { $set: { read: true } }
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

export default router
