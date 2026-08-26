import express from "express"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import User from "../models/User.js"
import Order from "../models/Order.js"
import FollowUpNote from "../models/FollowUpNote.js"

const router = express.Router()

/* ── GET /api/team/activity-radar — Team members activity tracking with inactivity days ── */
router.get("/activity-radar", protect, allowRoles("admin", "distributor", "seller"), async (req, res) => {
  try {
    const me = req.user.id
    const myRole = req.user.role

    // Recursive downline fetch helper
    const getAllChildren = async (parentId) => {
      const children = await User.find({ parentId, isDeleted: { $ne: true } })
        .select("_id name fullName role phone email address parentId sales teamSales createdAt")
      let list = [...children]
      for (const child of children) {
        const subs = await getAllChildren(child._id)
        list.push(...subs)
      }
      return list
    }

    let teamMembers = []
    if (myRole === "admin") {
      teamMembers = await User.find({ isDeleted: { $ne: true }, role: { $in: ["distributor", "seller", "user"] } })
        .select("_id name fullName role phone email address parentId sales teamSales createdAt")
    } else {
      teamMembers = await getAllChildren(me)
    }

    const now = new Date()

    // Enrich each member with their last order date and notes
    const enriched = await Promise.all(
      teamMembers.map(async (member) => {
        // Find member's most recent confirmed/placed order
        const lastOrder = await Order.findOne({
          $or: [{ sellerId: member._id }, { userId: member._id }, { placedById: member._id }]
        }).sort({ createdAt: -1 }).select("createdAt total status")

        let lastOrderDate = lastOrder ? lastOrder.createdAt : null
        let daysInactive = null

        if (lastOrderDate) {
          const diffMs = now - new Date(lastOrderDate)
          daysInactive = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        } else {
          // If no orders yet, calculate days since joining
          const joinDiffMs = now - new Date(member.createdAt)
          daysInactive = Math.floor(joinDiffMs / (1000 * 60 * 60 * 24))
        }

        // Determine activity category
        let activityStatus = "active" // < 7 days
        if (!lastOrder) {
          activityStatus = "new_onboarding"
        } else if (daysInactive >= 30) {
          activityStatus = "dormant" // 30+ days
        } else if (daysInactive >= 7) {
          activityStatus = "follow_up_needed" // 7-29 days
        }

        // Get latest follow-up note
        const notes = await FollowUpNote.find({ memberId: member._id })
          .sort({ createdAt: -1 })
          .limit(5)

        return {
          _id: member._id,
          name: member.name,
          fullName: member.fullName || member.name,
          role: member.role,
          phone: member.phone || "",
          email: member.email,
          address: member.address || "",
          sales: member.sales || 0,
          joinedAt: member.createdAt,
          lastOrderDate,
          daysInactive,
          activityStatus,
          lastNote: notes[0] || null,
          notesCount: notes.length,
          recentNotes: notes
        }
      })
    )

    // Sort: follow_up_needed and dormant first for high priority action
    enriched.sort((a, b) => {
      const order = { follow_up_needed: 1, dormant: 2, new_onboarding: 3, active: 4 }
      return (order[a.activityStatus] || 5) - (order[b.activityStatus] || 5)
    })

    res.json({
      success: true,
      totalTeamCount: enriched.length,
      counts: {
        active: enriched.filter(m => m.activityStatus === "active").length,
        follow_up_needed: enriched.filter(m => m.activityStatus === "follow_up_needed").length,
        dormant: enriched.filter(m => m.activityStatus === "dormant").length,
        new_onboarding: enriched.filter(m => m.activityStatus === "new_onboarding").length
      },
      members: enriched
    })
  } catch (err) {
    console.error("Activity radar error:", err)
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── POST /api/team/follow-up-note — Save follow-up remarks/notes ── */
router.post("/follow-up-note", protect, allowRoles("admin", "distributor", "seller"), async (req, res) => {
  try {
    const { memberId, note, contactMethod, status } = req.body
    if (!memberId || !note || !note.trim()) {
      return res.status(400).json({ success: false, message: "Member ID and Note content are required." })
    }

    const creator = await User.findById(req.user.id).select("name fullName role")

    const newNote = await FollowUpNote.create({
      memberId,
      createdById: req.user.id,
      createdByName: creator?.name || "",
      createdByFullName: creator?.fullName || creator?.name || "",
      createdByRole: creator?.role || req.user.role,
      note: note.trim(),
      contactMethod: contactMethod || "call",
      status: status || "follow_up_taken"
    })

    res.status(201).json({ success: true, note: newNote })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── GET /api/team/member-notes/:memberId — Get all follow-up notes for a member ── */
router.get("/member-notes/:memberId", protect, allowRoles("admin", "distributor", "seller"), async (req, res) => {
  try {
    const notes = await FollowUpNote.find({ memberId: req.params.memberId })
      .sort({ createdAt: -1 })
      .limit(30)
    res.json({ success: true, notes })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
