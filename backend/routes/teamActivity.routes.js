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
        .select("_id name fullName role phone email address parentId sales teamSales category createdAt")
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
        .select("_id name fullName role phone email address parentId sales teamSales category createdAt")
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
          category: member.category || "",
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

/* ── PUT /api/team/member-category/:id — Update member category ── */
router.put("/member-category/:id", protect, allowRoles("admin", "distributor", "seller"), async (req, res) => {
  try {
    const { category } = req.body
    const member = await User.findById(req.params.id)
    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" })
    }

    member.category = (category || "").trim()
    await member.save()

    res.json({
      success: true,
      message: "Category updated successfully",
      category: member.category
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/* ── POST /api/team/broadcast-whatsapp-api — Direct background WhatsApp sender ── */
router.post("/broadcast-whatsapp-api", protect, allowRoles("admin", "distributor", "seller"), async (req, res) => {
  try {
    const { recipients = [], messageTemplate = "followup", customText = "" } = req.body

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: "No recipients selected" })
    }

    // Check if WhatsApp Gateway is configured
    // 1. Meta WhatsApp Cloud API
    const metaToken = process.env.WHATSAPP_CLOUD_TOKEN
    const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID

    // 2. UltraMsg API
    const ultramsgInstance = process.env.ULTRAMSG_INSTANCE_ID
    const ultramsgToken = process.env.ULTRAMSG_TOKEN

    const isConfigured = Boolean((metaToken && metaPhoneId) || (ultramsgInstance && ultramsgToken))

    if (!isConfigured) {
      return res.status(200).json({
        success: false,
        isConfigured: false,
        message: "WhatsApp Gateway API (.env) me configure nahi hai. Direct background me bina WhatsApp khole bhejne ke liye Meta Cloud API ya UltraMsg API credentials zaroori hain."
      })
    }

    let sentCount = 0
    let failedCount = 0
    const results = []

    for (const item of recipients) {
      const { id, name, phone, category = "", daysInactive = 0 } = item
      if (!phone) {
        failedCount++
        results.push({ id, name, status: "failed", reason: "Phone number missing" })
        continue
      }

      const cleanPhone = phone.replace(/[^0-9]/g, "")
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone

      // Construct personalized message
      let msg = ""
      if (messageTemplate === "custom") {
        msg = (customText || "")
          .replace(/{name}/g, name || "Ji")
          .replace(/{category}/g, category || "General")
          .replace(/{daysInactive}/g, `${daysInactive}`)
          .replace(/{storeLink}/g, "https://educa-store.vercel.app/")
      } else if (messageTemplate === "category") {
        msg = `Namaste ${name || "Ji"} ji! 👋\n\nHum EDUCA VEDA se connect kar rahe hain. Aapke *${category || "Health"}* related health requirements ke liye hamare paas pure Ayurvedic formulations available hain.\n\nKoi help ya consultation chahiye toh batayein!\n🛍️ Store Link: https://educa-store.vercel.app/`
      } else if (messageTemplate === "offer") {
        msg = `🎉 Namaste ${name || "Ji"} ji! EDUCA VEDA par naye Ayurvedic formulations aur special health offers live ho gaye hain.\n\nApne manpasand products dekhne aur order karne ke liye visit karein:\n🛍️ Store Link: https://educa-store.vercel.app/`
      } else {
        msg = `Namaste ${name || "Ji"} ji! 👋\n\nHumne notice kiya aapne pichle *${daysInactive}* dino se EDUCA VEDA me koi naya order nahi lagaya hai. Koi product guidance ya order placement me help chahiye toh batayein!\n\n🛍️ Store Link: https://educa-store.vercel.app/`
      }

      try {
        if (ultramsgInstance && ultramsgToken) {
          // Send via UltraMsg
          const uRes = await fetch(`https://api.ultramsg.com/${ultramsgInstance}/messages/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: ultramsgToken,
              to: formattedPhone,
              body: msg
            })
          })
          const uData = await uRes.json()
          if (uData.sent === "true" || uData.id) {
            sentCount++
            results.push({ id, name, status: "sent", messageId: uData.id })
          } else {
            failedCount++
            results.push({ id, name, status: "failed", reason: uData.error || "UltraMsg error" })
          }
        } else if (metaToken && metaPhoneId) {
          // Send via Meta Cloud API
          const mRes = await fetch(`https://graph.facebook.com/v19.0/${metaPhoneId}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${metaToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: formattedPhone,
              type: "text",
              text: { body: msg }
            })
          })
          const mData = await mRes.json()
          if (mData.messages && mData.messages[0]) {
            sentCount++
            results.push({ id, name, status: "sent", messageId: mData.messages[0].id })
          } else {
            failedCount++
            results.push({ id, name, status: "failed", reason: mData.error?.message || "Meta API error" })
          }
        }

        // Auto-log note in MongoDB
        if (id) {
          await FollowUpNote.create({
            memberId: id,
            createdById: req.user.id,
            createdByName: req.user.name || "System",
            createdByFullName: req.user.fullName || req.user.name || "",
            createdByRole: req.user.role,
            note: `Direct WhatsApp Broadcast sent [${messageTemplate}]`,
            contactMethod: "whatsapp",
            status: "follow_up_taken"
          })
        }
      } catch (err) {
        failedCount++
        results.push({ id, name, status: "failed", reason: err.message })
      }
    }

    res.json({
      success: true,
      isConfigured: true,
      sentCount,
      failedCount,
      results
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
