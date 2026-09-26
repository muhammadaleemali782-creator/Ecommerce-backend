import express from "express"
import multer from "multer"
import fs from "fs"
import auth from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import WithdrawalRequest from "../models/WithdrawalRequest.js"
import PPCSettings from "../models/PPCSettings.js"
import User from "../models/User.js"
import Commission from "../commission/commission.model.js"

const router = express.Router()

/* ── Lightweight Upload setup for Payment Proof / Receipts (In-memory, zero local disk bloat) ── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
})

/* =====================================================
   USER → CREATE WITHDRAWAL REQUEST
===================================================== */
router.post("/request", auth, allowRoles("distributor", "seller"), async (req, res) => {
  try {
    
    const { walletType, amount, paymentMethod, paymentDetails, qrBase64 } = req.body

    // Validations
    if (!walletType || !amount) {
      return res.status(400).json({ message: "Wallet type and amount required" })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ message: "Amount must be positive" })
    }
    
    // Check minimum withdrawal limit
    const settings = await PPCSettings.getSettings()
    const minPPC = settings?.minimumWithdrawal ?? 1
    if (amount < minPPC) {
      return res.status(400).json({ 
        message: `Minimum withdrawal amount is ${minPPC} PPC` 
      })
    }
    
    // Get user
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }
    
    // Role-based wallet validation
    if (user.role === "distributor") {
      if (!["sellerWallet"].includes(walletType)) {
        return res.status(400).json({ 
          message: "Distributor can only withdraw from sellerWallet" 
        })
      }
      
      // Check balance
      const balance = user[walletType] || 0
      if (amount > balance) {
        return res.status(400).json({ 
          message: `Insufficient balance. Available: ₹${balance}` 
        })
      }
    }
    
    if (user.role === "seller") {
      if (!["sellerWalletAsSeller", "userWalletAsSeller"].includes(walletType)) {
        return res.status(400).json({ 
          message: "Invalid wallet type for seller" 
        })
      }
      
      // Check balance
      const balance = user[walletType] || 0
      if (amount > balance) {
        return res.status(400).json({ 
          message: `Insufficient balance. Available: ₹${balance}` 
        })
      }
    }
    
    // Check for pending requests
    const pending = await WithdrawalRequest.findOne({
      userId: user._id,
      status: "pending"
    })
    
    if (pending) {
      return res.status(400).json({ 
        message: "You already have a pending withdrawal request" 
      })
    }

    // ⭐ PPC rate us time ka lock karo
    const currentRate = settings.basePPCValue

    // ✅ FIX: Actual avg percentage from commission history
    let percentage = 50  // default
    try {
      const commissions = await Commission.find({ toUser: user._id, status: "approved" })
        .select("percentageShare ppcCount")
      if (commissions.length > 0) {
        const totalPPC    = commissions.reduce((s, c) => s + (c.ppcCount || 0), 0)
        const weightedPct = commissions.reduce((s, c) => s + (c.percentageShare || 50) * (c.ppcCount || 0), 0)
        percentage = totalPPC > 0 ? Math.round(weightedPct / totalPPC) : 50
      }
    } catch (e) {
      console.error("Commission lookup error:", e.message)
      percentage = 50
    }

    // Calculate locked rupee value
    const rupeeValue = Number(amount) * (Number(currentRate) || 0) * (Number(percentage) / 100)

    // Create request with zero local storage
    const request = await WithdrawalRequest.create({
      userId: user._id,
      userRole: user.role,
      walletType,
      amount,
      balanceAtRequest: user[walletType] || 0,
      ppcRateAtRequest: currentRate,        // ⭐ rate lock
      percentageAtRequest: percentage,       // ⭐ share % lock
      rupeeValueAtRequest: rupeeValue,       // ⭐ rupee value lock
      paymentMethod: paymentMethod || "",
      paymentDetails: paymentDetails || "",
      qrCodeUrl: "",
      status: "pending"
    })
    
    console.log("💳 Withdrawal request created:", request._id)

    // 📊 Save QR to Google Drive & record in Google Sheet
    const webhookUrl = settings?.googleSheetWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL
    if (webhookUrl) {
      const originWallet = 
        walletType === "userWalletAsSeller" ? "User Wallet" :
        walletType === "sellerWalletAsSeller" ? "Direct Seller Wallet" :
        walletType === "sellerWallet" ? "Direct Seller Wallet" :
        walletType === "distSellerWallet" ? "Distributor's Direct Seller Wallet" :
        walletType === "distributorWallet" ? "Distributor Wallet" : walletType

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 6000)

        const sheetRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action: "CREATE",
            requestId: String(request._id),
            date: `${new Date().toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" })}, ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            name: user.fullName || user.name,
            userId: user.name,
            role: user.role,
            phone: user.phone || "",
            email: user.email || "",
            originWallet,
            amountPPC: amount,
            rupeeValue: rupeeValue.toFixed(2),
            paymentMethod: paymentMethod || "",
            paymentDetails: paymentDetails || "",
            qrCodeUrl: "",
            qrBase64: qrBase64 || "",
            utrNumber: "",
            status: "PENDING",
            screenshot: "",
            remarks: ""
          })
        })
        clearTimeout(timeoutId)
        const sheetData = await sheetRes.json()
        if (sheetData?.qrUrl) {
          request.qrCodeUrl = sheetData.qrUrl
          await request.save()
        }
      } catch (err) {
        console.error("Google Sheet webhook error:", err.message)
      }
    }
    
    res.json({ 
      success: true, 
      message: "Withdrawal request submitted successfully",
      request 
    })
    
  } catch (err) {
    console.error("Withdrawal request error:", err)
    res.status(500).json({ message: "Failed to create withdrawal request" })
  }
})

/* =====================================================
   USER → MY WITHDRAWAL REQUESTS
===================================================== */
router.get("/my-requests", auth, allowRoles("distributor", "seller"), async (req, res) => {
  try {
    
    const requests = await WithdrawalRequest.find({
      userId: req.user.id
    })
      .sort({ createdAt: -1 })
      .lean()
    
    res.json(requests)
    
  } catch (err) {
    console.error("Get my requests error:", err)
    res.status(500).json({ message: "Failed to load requests" })
  }
})

/* =====================================================
   ADMIN → UPLOAD PAYMENT PROOF SCREENSHOT
===================================================== */
router.post("/admin/upload-proof", auth, allowRoles("admin"), upload.single("proof"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" })
    }
    const mime = req.file.mimetype || "image/jpeg"
    const base64 = `data:${mime};base64,${req.file.buffer.toString("base64")}`
    
    // Save to Google Drive via Apps Script webhook
    const settings = await PPCSettings.findOne().lean()
    const webhookUrl = settings?.googleSheetWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL
    if (webhookUrl) {
      try {
        const sheetRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UPLOAD_FILE",
            fileBase64: base64,
            fileName: `Slip-${Date.now()}`
          })
        })
        const sheetData = await sheetRes.json()
        if (sheetData?.url) {
          return res.json({ success: true, url: sheetData.url })
        }
      } catch (err) {
        console.error("Drive upload webhook error:", err.message)
      }
    }
    
    // Fallback if webhook unreachable: return compressed base64
    res.json({ success: true, url: base64 })
  } catch (err) {
    console.error("Proof upload error:", err)
    res.status(500).json({ message: "Failed to upload payment proof" })
  }
})

/* =====================================================
   ADMIN → UPDATE / ATTACH PAYMENT PROOF
===================================================== */
router.post("/admin/update-proof/:id", auth, allowRoles("admin"), async (req, res) => {
  try {
    const { paymentProof } = req.body
    const request = await WithdrawalRequest.findById(req.params.id)
    if (!request) {
      return res.status(404).json({ message: "Request not found" })
    }
    request.paymentProof = (paymentProof || "").trim()
    await request.save()

    // 📊 Sync proof to Google Sheet
    try {
      const settings = await PPCSettings.getSettings()
      const webhookUrl = settings?.googleSheetWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL
      if (webhookUrl) {
        const publicProof = paymentProof 
          ? (paymentProof.startsWith("http") ? paymentProof : `${req.protocol}://${req.get("host")}${paymentProof}`)
          : ""
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UPDATE",
            requestId: String(request._id),
            systemId: "",
            utrNumber: request.transactionId || request.utrNumber || "",
            status: request.status.toUpperCase(),
            screenshot: publicProof,
            remarks: request.adminNote || ""
          })
        }).catch(err => console.error("Sheet proof sync error:", err.message))
      }
    } catch (_) {}

    res.json({ success: true, message: "Payment proof updated", request })
  } catch (err) {
    console.error("Update proof error:", err)
    res.status(500).json({ message: "Failed to update payment proof" })
  }
})

/* =====================================================
   ADMIN → ALL WITHDRAWAL REQUESTS
===================================================== */
router.get("/admin/all", auth, allowRoles("admin"), async (req, res) => {
  try {
    
    const { status } = req.query
    
    const query = status ? { status } : {}
    
    const requests = await WithdrawalRequest.find(query)
      .populate("userId", "name fullName email role phone")
      .sort({ createdAt: -1 })
    
    res.json(requests)
    
  } catch (err) {
    console.error("Get all requests error:", err)
    res.status(500).json({ message: "Failed to load requests" })
  }
})

/* =====================================================
   ADMIN → APPROVE WITHDRAWAL
===================================================== */
router.post("/admin/approve/:id", auth, allowRoles("admin"), async (req, res) => {
  try {
    
    const { transactionId, utrNumber, note, paymentProof } = req.body
    const finalUtr = (utrNumber || transactionId || "").trim()

    if (!finalUtr) {
      return res.status(400).json({ 
        message: "Payment UTR / Bank Reference Number is required to approve withdrawal" 
      })
    }
    
    const request = await WithdrawalRequest.findById(req.params.id)
    if (!request) {
      return res.status(404).json({ message: "Request not found" })
    }
    
    if (request.status !== "pending") {
      return res.status(400).json({ message: "Request already processed" })
    }
    
    // Get user
    const user = await User.findById(request.userId)
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }
    
    // Deduct from wallet
    const walletBalance = user[request.walletType] || 0
    
    if (request.amount > walletBalance) {
      return res.status(400).json({ 
        message: "Insufficient balance in user wallet" 
      })
    }
    
    user[request.walletType] = walletBalance - request.amount
    
    // ⭐ Purani locked rate se rupee value calculate karo
    const lockedRate = request.ppcRateAtRequest || 0
    const lockedPercentage = request.percentageAtRequest || 50
    const rupeesPaid = request.amount * lockedRate * (lockedPercentage / 100)

    user.totalWithdrawn = (user.totalWithdrawn || 0) + request.amount
    await user.save()
    
    // Approve request
    request.approve(req.user.id, note || "", finalUtr, (paymentProof || "").trim())
    await request.save()
    
    console.log("✅ Withdrawal approved:", request._id)
    console.log(`💰 Paid: ${request.amount} PPC × ₹${lockedRate} × ${lockedPercentage}% = ₹${rupeesPaid.toFixed(2)} | UTR: ${finalUtr}`)

    // 📊 Sync approval to Google Sheet
    try {
      const settings = await PPCSettings.getSettings()
      const webhookUrl = settings?.googleSheetWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL
      if (webhookUrl) {
        const publicProof = (paymentProof || "").trim() 
          ? ((paymentProof || "").startsWith("http") ? paymentProof : `${req.protocol}://${req.get("host")}${paymentProof}`)
          : ""
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UPDATE",
            requestId: String(request._id),
            systemId: user.name,
            utrNumber: finalUtr,
            status: "APPROVED",
            screenshot: publicProof,
            remarks: note || "PAYMENT DONE"
          })
        }).catch(err => console.error("Sheet approve sync error:", err.message))
      }
    } catch (_) {}
    
    res.json({ 
      success: true, 
      message: "Withdrawal approved successfully",
      rupeesPaid: rupeesPaid.toFixed(2),
      lockedRate,
      utrNumber: finalUtr,
      transactionId: finalUtr,
      request 
    })
    
  } catch (err) {
    console.error("Approve withdrawal error:", err)
    res.status(500).json({ message: "Failed to approve withdrawal" })
  }
})

/* =====================================================
   ADMIN → REJECT WITHDRAWAL
===================================================== */
router.post("/admin/reject/:id", auth, allowRoles("admin"), async (req, res) => {
  try {
    
    const { reason } = req.body
    
    const request = await WithdrawalRequest.findById(req.params.id)
    if (!request) {
      return res.status(404).json({ message: "Request not found" })
    }
    
    if (request.status !== "pending") {
      return res.status(400).json({ message: "Request already processed" })
    }
    
    // Reject request
    request.reject(req.user.id, reason || "Rejected by admin")
    await request.save()
    
    console.log("❌ Withdrawal rejected:", request._id)

    // 📊 Sync rejection to Google Sheet
    try {
      const settings = await PPCSettings.getSettings()
      const webhookUrl = settings?.googleSheetWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UPDATE",
            requestId: String(request._id),
            systemId: "",
            utrNumber: "",
            status: "REJECTED",
            screenshot: "",
            remarks: reason || "REJECTED BY ADMIN"
          })
        }).catch(err => console.error("Sheet reject sync error:", err.message))
      }
    } catch (_) {}
    
    res.json({ 
      success: true, 
      message: "Withdrawal rejected",
      request 
    })
    
  } catch (err) {
    console.error("Reject withdrawal error:", err)
    res.status(500).json({ message: "Failed to reject withdrawal" })
  }
})

/* =====================================================
   GOOGLE SHEET TWO-WAY SYNC (Webhook from Google Apps Script)
   When Admin updates UTR, Status, or Screenshot in Google Sheet,
   this route updates the withdrawal request on the website.
===================================================== */
router.post("/sheet-sync", async (req, res) => {
  try {
    const { systemId, utrNumber, status, screenshot, remarks } = req.body
    if (!systemId) {
      return res.status(400).json({ message: "systemId is required" })
    }

    const user = await User.findOne({ name: systemId })
    if (!user) {
      return res.status(404).json({ message: `User with system ID ${systemId} not found` })
    }

    // Find pending or latest withdrawal request
    let request = await WithdrawalRequest.findOne({ userId: user._id, status: "pending" })
    if (!request) {
      request = await WithdrawalRequest.findOne({ userId: user._id }).sort({ createdAt: -1 })
    }
    if (!request) {
      return res.status(404).json({ message: "No withdrawal request found for this user" })
    }

    const newStatus = (status || "").trim().toLowerCase()
    
    // Status change handling
    if (newStatus === "approved" && request.status !== "approved") {
      const walletBalance = user[request.walletType] || 0
      if (request.amount <= walletBalance) {
        user[request.walletType] = walletBalance - request.amount
        user.totalWithdrawn = (user.totalWithdrawn || 0) + request.amount
        await user.save()
      }
      request.status = "approved"
      request.approvedAt = new Date()
    } else if (newStatus === "rejected" && request.status !== "rejected") {
      request.status = "rejected"
      request.rejectedAt = new Date()
      request.rejectionReason = remarks || "Rejected via Google Sheet"
    }

    if (utrNumber) {
      request.transactionId = utrNumber.trim()
      request.utrNumber = utrNumber.trim()
    }
    if (screenshot) {
      request.paymentProof = screenshot.trim()
    }
    if (remarks) {
      request.adminNote = remarks.trim()
    }

    if (req.body.qrCodeUrl || req.body.qrUrl) {
      request.qrCodeUrl = (req.body.qrCodeUrl || req.body.qrUrl).trim()
    }

    await request.save()
    console.log(`📊 Google Sheet sync: Request ${request._id} (${systemId}) updated: status=${request.status}, utr=${request.transactionId}`)

    res.json({ success: true, message: "Sync successful", request })
  } catch (err) {
    console.error("Sheet sync error:", err)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Clean any fake/dummy drive links from MongoDB
const cleanDummyLinks = async () => {
  try {
    await WithdrawalRequest.updateMany(
      { qrCodeUrl: { $regex: /1-qtU07Pt0PwscZ6lGCDhxmfX3lqwT9wc|1TVmN5tWT_puFbTIyUrTsssic4mNPpSK|^\/uploads\// } },
      { $set: { qrCodeUrl: "" } }
    )
  } catch (e) {
    console.error("Clean dummy links error:", e.message)
  }
}
setTimeout(cleanDummyLinks, 2000)

export default router
