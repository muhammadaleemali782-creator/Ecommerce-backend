import express from "express"
import auth from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import WithdrawalRequest from "../models/WithdrawalRequest.js"
import PPCSettings from "../models/PPCSettings.js"
import User from "../models/User.js"
import Commission from "../commission/commission.model.js"

const router = express.Router()

/* =====================================================
   USER → CREATE WITHDRAWAL REQUEST
===================================================== */
router.post("/request", auth, allowRoles("distributor", "seller"), async (req, res) => {
  try {
    
    const { walletType, amount, paymentMethod, paymentDetails } = req.body
    
    // Validations
    if (!walletType || !amount) {
      return res.status(400).json({ message: "Wallet type and amount required" })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ message: "Amount must be positive" })
    }
    
    // Check minimum withdrawal limit
    const settings = await PPCSettings.getSettings()
    if (amount < settings.minimumWithdrawal) {
      return res.status(400).json({ 
        message: `Minimum withdrawal amount is ₹${settings.minimumWithdrawal}` 
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

    const rupeeValue = amount * currentRate * (percentage / 100)
    
    // Create request
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
      status: "pending"
    })
    
    console.log("💳 Withdrawal request created:", request._id)
    
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
   ADMIN → ALL WITHDRAWAL REQUESTS
===================================================== */
router.get("/admin/all", auth, allowRoles("admin"), async (req, res) => {
  try {
    
    const { status } = req.query
    
    const query = status ? { status } : {}
    
    const requests = await WithdrawalRequest.find(query)
      .populate("userId", "name email role phone")
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
    
    const { transactionId, note } = req.body
    
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
    request.approve(req.user.id, note || "", transactionId || "")
    await request.save()
    
    console.log("✅ Withdrawal approved:", request._id)
    console.log(`💰 Paid: ${request.amount} PPC × ₹${lockedRate} × ${lockedPercentage}% = ₹${rupeesPaid.toFixed(2)}`)
    
    res.json({ 
      success: true, 
      message: "Withdrawal approved successfully",
      rupeesPaid: rupeesPaid.toFixed(2),
      lockedRate,
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

export default router
