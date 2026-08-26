/* =====================================================
   MONGODB CONNECTION
===================================================== */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import { getFirebaseAdmin } from "./utils/firebaseAdmin.js"

// 💚 Server start hote hi ek baar check kar lo Firebase sahi se juda hai ya nahi
// (asli push bhejne ke time bhi ye hi function call hota hai — yahan sirf status
// pata karne ke liye pehle se call kar rahe hain)
getFirebaseAdmin()

mongoose
  .connect(process.env.MONGO_URI, { autoIndex: true })
  .then(async () => {
    console.log("✅ MongoDB connected")
    /* ⭐ FIX: UserRequest collection ka MongoDB-level validator clear karo
       Yeh tab zaruri hota hai jab enum change ho aur purana validator cached ho */
    try {
      const db = mongoose.connection.db
      await db.command({
        collMod: "userrequests",
        validator: {},
        validationLevel: "off"
      })
      console.log("✅ UserRequest validator cleared")
    } catch (e) {
      // Collection exist nahi karta ya pehle se theek hai — ignore
    }
  })
  .catch(err => console.error("❌ MongoDB error:", err.message))

/* =====================================================
   IMPORTS
===================================================== */
import express from "express"
import cors from "cors"
import multer from "multer"
import fs from "fs"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

import protect from "./middleware/auth.js"
import allowRoles from "./middleware/allowRoles.js"
import User from "./models/User.js"
import Order from "./models/Order.js"
import Product from "./models/Product.js"
import UserRequest from "./models/UserRequest.js"
import Settings from "./models/Settings.js"
import Commission from "./commission/commission.model.js"
import crypto from "crypto"
import orderRoutes from "./routes/orders.js"
import usersRoutes from "./routes/users.js"   // ⭐ EXACT PATH
import userIdRoutes from "./routes/userIdRoutes.js"
import { generateUserId } from "./utils/generateUserId.js"

// ⭐ NEW PPC SYSTEM IMPORTS
import withdrawalRoutes from "./routes/withdrawal.routes.js"
import rewardClaimRoutes from "./routes/rewardClaim.routes.js"
import ppcSettingsRoutes from "./routes/ppcSettings.routes.js"
import { createPPCCommissionFromOrder, getMyPPCWallet } from "./commission/ppcCommission.controller.js"

// 🔔 NOTIFICATIONS
import notificationRoutes from "./routes/notifications.js"
import { notifyNewUserRequest, notifyRequestApproved, notifyRequestRejected } from "./utils/notifHelper.js"
import { validateIdNumber } from "./utils/idValidation.js"

// 🧩 SERVICES (blog-jaise link cards)
import servicesRoutes from "./routes/services.js"

// 🎬 HOME BANNERS (admin-controlled hero ads — image/gif/video)
import bannersRoutes from "./routes/banners.js"


/* =====================================================
   APP INIT
===================================================== */

const app = express()
app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())

// 💚 HEALTH CHECK — Render free-tier cold-start ping ke liye
// Frontend/app isko boot pe call karta hai taaki server "wake up" ho jaye
app.get("/health", (req, res) => res.json({ status: "ok" }))

app.use("/orders", orderRoutes)

// ⭐ NEW PPC SYSTEM ROUTES
import royaltyRoutes from "./routes/royalty.routes.js"
import teamActivityRoutes from "./routes/teamActivity.routes.js"

app.use("/api/withdrawal", withdrawalRoutes)
app.use("/api/rewards", rewardClaimRoutes)
app.use("/api/ppc-settings", ppcSettingsRoutes)
app.use("/api/royalty", royaltyRoutes)
app.use("/api/team", teamActivityRoutes)
app.get("/api/ppc/wallet/me", protect, getMyPPCWallet)

// 🔔 NOTIFICATION ROUTES
app.use("/api/notifications", notificationRoutes)

// 🧩 SERVICES ROUTES
app.use("/api/services", servicesRoutes)
app.use("/api/banners", bannersRoutes)

app.use("/users", usersRoutes)
app.use("/users",userIdRoutes)

/* =====================================================
   CONFIG
===================================================== */
const PORT = process.env.PORT || 5000
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"

/* =====================================================
   UPLOADS SETUP
===================================================== */
const uploadDir = "uploads"
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)
app.use("/uploads", express.static(uploadDir))

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname)
  }
})
const upload = multer({ storage })


/* =====================================================
   LEGACY ADMIN LOGIN (DO NOT TOUCH)
===================================================== */
const ADMIN = {
  email: "admin@gmail.com",
  password: "12345"
}

/* =====================================================
   DEMO PRODUCTS (LEGACY)
===================================================== */
let products = [
  { id: 1, title: "Headphone", price: 1999, image: "" },
  { id: 2, title: "Watch", price: 2999, image: "" }
]

/* =====================================================
   AUTH HELPER
===================================================== */
const generateToken = (user) =>
  jwt.sign(
    {
      id: String(user._id),
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "1d" }
  )

/* =====================================================
   AUTH ROUTES
===================================================== */

app.post("/admin/login", (req, res) => {

  console.log("LOGIN BODY:", req.body)   // ⭐ moved inside route

  const { email, password } = req.body

  if (
    email?.trim().toLowerCase() === ADMIN.email &&
    password === ADMIN.password
  ) {
    console.log("✅ ADMIN LOGIN SUCCESS:", email)
    return res.json({ success: true })
  }

  console.log("❌ ADMIN LOGIN FAILED:", email)
  return res.status(401).json({ success: false })   // ⭐ return added
})



/* =====================================================
   USER LOGIN
===================================================== */

app.post("/login", async (req, res) => {

  console.log("LOGIN BODY:", req.body)   // ⭐ IMPORTANT DEBUG

  const { email, password } = req.body

  try {

    /* ⭐ EXTRA DEBUG */
    console.log("DB NAME =", mongoose.connection.name)

    /* ✅ EMPTY CHECK */
    if (!email || !password) {
      console.log("❌ LOGIN FAIL: Empty email/password")
      return res.status(400).json({
        success: false,
        message: "Email & password required"
      })
    }

    /* ⭐ PASSWORD TYPE CHECK FIRST */
    if (typeof password !== "string") {
      console.log("❌ LOGIN FAIL: Password undefined from frontend")
      return res.status(400).json({
        success: false,
        message: "Invalid password"
      })
    }

    /* ✅ EMAIL CLEAN */
    const cleanEmail = email.trim().toLowerCase()

    /* ✅ FIND USER  ⭐⭐⭐ IMPORTANT FIX HERE */
    const user = await User.findOne({ email: cleanEmail })
      .select("+password")   // 🔥 PASSWORD ko force select karo
      .lean()

    if (!user) {
      console.log("❌ LOGIN FAIL: User not found", cleanEmail)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      })
    }

    console.log("USER FOUND:", user.email)

    /* ⭐ LOCKOUT TIME CHECK */
    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      const remainingMs = new Date(user.lockUntil) - new Date()
      const remainingMins = Math.ceil(remainingMs / (60 * 1000))
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000))
      const timeMsg = remainingMins < 60 ? `${remainingMins} minutes` : `${remainingHours} hours`
      console.log(`🔒 LOGIN BLOCKED: Account locked for ${cleanEmail} (${timeMsg} remaining)`)
      return res.status(429).json({
        success: false,
        message: `Security Lockout Active: Too many failed password attempts. Please try again after ${timeMsg}, or contact Admin.`
      })
    }

    /* ⭐ 90-DAY (3-MONTH) DORMANT AUTO-LOCK CHECK */
    if (user.role !== "admin") {
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const lastActive = user.lastLoginDate || user.createdAt
      if (lastActive && new Date(lastActive) < threeMonthsAgo) {
        await User.findByIdAndUpdate(user._id, { isDormantLocked: true })
        return res.status(403).json({
          success: false,
          message: "🔒 Account Inactivity Lock: Aapki ID 3 mahine se inactive hone ke karan security lock ho gayi hai. Unlock karne ke liye Admin ko request bhejein."
        })
      }
    }

    /* ⭐ PASSWORD EXIST CHECK */
    if (!user.password || user.password === "") {
      console.log("❌ LOGIN FAIL: Password missing in DB for", cleanEmail)
      return res.status(500).json({
        success: false,
        message: "User password not set. Contact admin."
      })
    }

    /* ✅ PASSWORD MATCH */
    const match = await bcrypt.compare(
      password.trim(),
      user.password
    )

    console.log("PASSWORD MATCH =", match)

    if (!match) {
      console.log("❌ LOGIN FAIL: Wrong password for", cleanEmail)
      const userDoc = await User.findById(user._id)
      const attempts = (userDoc?.failedLoginAttempts || 0) + 1
      let lockUntil = null
      let alertMsg = `Invalid credentials. (${attempts} failed attempt${attempts > 1 ? "s" : ""})`

      if (attempts >= 20) {
        lockUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) // 10 years permanent lock
        alertMsg = "🚨 MAXIMUM ATTEMPTS EXCEEDED (20+): Account locked permanently. Only Admin can unlock."
      } else if (attempts >= 10) {
        lockUntil = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
        alertMsg = "⚠️ 10 failed attempts: Account locked for 1 hour for security protection."
      } else if (attempts >= 5) {
        lockUntil = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
        alertMsg = "⚠️ 5 failed attempts: Account locked for 5 minutes."
      }

      if (userDoc) {
        userDoc.failedLoginAttempts = attempts
        userDoc.lockUntil = lockUntil
        await userDoc.save()
      }

      return res.status(401).json({
        success: false,
        message: alertMsg,
        failedAttempts: attempts
      })
    }

    console.log("✅ LOGIN SUCCESS:", user.email)
    console.log("Must Change Password:", user.mustChangePassword)

    // Reset failed counter & record client device info
    const ua = req.headers["user-agent"] || ""
    const clientIP = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
    let deviceInfo = "Unknown Device"
    if (/android/i.test(ua)) deviceInfo = "Android Phone"
    else if (/iphone/i.test(ua)) deviceInfo = "Apple iPhone"
    else if (/ipad/i.test(ua)) deviceInfo = "Apple iPad"
    else if (/macintosh/i.test(ua)) deviceInfo = "Mac Computer"
    else if (/windows/i.test(ua)) deviceInfo = "Windows PC"
    else if (/linux/i.test(ua)) deviceInfo = "Linux System"

    if (/chrome/i.test(ua)) deviceInfo += " (Chrome)"
    else if (/safari/i.test(ua)) deviceInfo += " (Safari)"
    else if (/firefox/i.test(ua)) deviceInfo += " (Firefox)"
    else if (/edge/i.test(ua)) deviceInfo += " (Edge)"

    await User.findByIdAndUpdate(user._id, {
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLoginDate: new Date(),
      lastActiveDevice: deviceInfo,
      lastLoginIP: clientIP
    })

    /* ✅ TEMP PASSWORD */
    if (user.mustChangePassword === true) {
      console.log("⚠️ TEMP PASSWORD LOGIN → NEED CHANGE")

      return res.json({
        success: true,
        changePasswordRequired: true,
        userId: user._id,
        email: user.email
      })
    }
    /* ⭐ BLOCK CHECK */
      if (user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "User is blocked by admin"
        })
      }

      if (user.isDeleted) {
        return res.status(403).json({
          success: false,
          message: "User account deleted"
        })
      }
    /* ✅ NORMAL LOGIN */
    const token = generateToken(user)

    console.log("🎯 TOKEN GENERATED FOR:", user.email)

    return res.json({
      success: true,
      token,
      role: user.role,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role
      }
    })

  } catch (err) {
    console.error("❌ LOGIN ERROR:", err)
    return res.status(500).json({
      success: false,
      message: "Server error"
    })
  }
})

/*=========================================================
            Change Password
==========================================================*/

app.post("/users/change-password", async (req, res) => {
  try {

    console.log("CHANGE PASSWORD BODY:", req.body)

    let { userId, newPassword } = req.body

    if (!userId || !newPassword)
      return res.status(400).json({
        success: false,
        message: "Missing data"
      })

    const user = await User.findById(userId)

    if (!user)
      return res.status(404).json({
        success: false,
        message: "User not found"
      })

    const hashed = await bcrypt.hash(newPassword.trim(), 10)

    user.password = hashed
    user.mustChangePassword = false

    await user.save()

    console.log("✅ Password changed for:", user.email)

    return res.json({
      success: true,
      message: "Password changed successfully"
    })

  } catch (err) {
    console.error("❌ CHANGE PASSWORD ERROR:", err)
    return res.status(500).json({
      success: false,
      message: err.message
    })
  }
})

/* =====================================================
   ⭐ EDUCA MAIL SINGLE SIGN-ON (SSO) & SELF-RESET
===================================================== */
import { provisionMailbox, sendEducaMail } from "./services/mailServerClient.js"

// In-memory OTP storage with 10-minute expiry
const otpStore = new Map()

// 1. Send OTP to EDUCA Mail
app.post("/api/auth/mail-reset/send-otp", async (req, res) => {
  try {
    const { identifier } = req.body
    if (!identifier) return res.status(400).json({ success: false, message: "Identifier or Email required" })

    const clean = identifier.trim().toLowerCase()
    const user = await User.findOne({ $or: [{ email: clean }, { name: clean }] })
    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found" })
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000))
    otpStore.set(String(user._id), { otp, expiresAt: Date.now() + 10 * 60 * 1000 })

    // Send OTP into user's EDUCA Mailbox
    await sendEducaMail({
      to: user.name || user.email,
      subject: "🔒 EDUCA VEDA - Password Reset OTP",
      body: `Namaste ${user.fullName || user.name},\n\nAapka password reset OTP hai: ${otp}\n\nYeh OTP agle 10 minutes tak valid hai. Kripya kisi ke sath share na karein.\n\nTeam EDUCA VEDA`
    })

    res.json({
      success: true,
      message: `OTP sent to your EDUCA Mail (${user.name}@educaveda.com / ${user.email}). Check your mail server inbox!`,
      userId: user._id
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// 2. Verify OTP and Self-Reset Password
app.post("/api/auth/mail-reset/verify-and-reset", async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body
    if (!userId || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "All fields are required" })
    }

    const entry = otpStore.get(String(userId))
    if (!entry || entry.expiresAt < Date.now() || entry.otp !== otp.trim()) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" })
    }

    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ success: false, message: "User not found" })

    const hash = await bcrypt.hash(newPassword.trim(), 10)
    user.password = hash
    user.mustChangePassword = false
    user.failedLoginAttempts = 0
    user.lockUntil = null
    user.isDormantLocked = false
    await user.save()

    otpStore.delete(String(userId))

    res.json({ success: true, message: "Password reset successful! You can now log in." })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// 3. EDUCA Mail Direct SSO
app.post("/api/auth/educa-sso", async (req, res) => {
  try {
    const { identifier, password } = req.body
    if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" })

    const clean = identifier.trim().toLowerCase()
    const user = await User.findOne({ $or: [{ email: clean }, { name: clean }] }).select("+password")
    if (!user) return res.status(404).json({ success: false, message: "EDUCA account not found" })

    if (password) {
      const match = await bcrypt.compare(password.trim(), user.password)
      if (!match) return res.status(401).json({ success: false, message: "Invalid EDUCA credentials" })
    }

    const token = generateToken(user)
    res.json({
      success: true,
      token,
      role: user.role,
      user: {
        id: String(user._id),
        name: user.name,
        fullName: user.fullName || user.name,
        email: user.email,
        role: user.role
      }
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/*=========================================================
            Admin Unlock Security Lock
==========================================================*/
app.put("/admin/unlock-security/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: "User not found" })
    user.failedLoginAttempts = 0
    user.lockUntil = null
    user.isDormantLocked = false
    user.isBlocked = false
    await user.save()
    console.log(`🔓 Security lock reset for: ${user.email}`)
    res.json({ success: true, message: "Account security lock cleared" })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/* =====================================================
   PRODUCTS
===================================================== */

app.get(
  "/products/all",
  protect,
  async (req, res) => {
    try {
      let query = {}

      /* ================= ADMIN ================= */
      if (req.user.role === "admin") {
        query = {}
      }

    /* ================= DISTRIBUTOR ================= */
  if (req.user.role === "distributor") {
    const distributor = await User.findById(req.user.id)

    // ⭐ Agar koi specific products assign nahi kiye to SAARE products dikhao
    if (!distributor || !distributor.assignedProducts?.length) {
      const allProducts = await Product.find({}).sort({ createdAt: -1 })
      return res.json(allProducts)
    }

    query = {
      _id: {
        $in: distributor.assignedProducts.map(
          id => new mongoose.Types.ObjectId(id)
        )
      }
    }
  }

      /* ================= SELLER ================= */
if (req.user.role === "seller") {
  const seller = await User.findById(req.user.id)

  if (!seller || !seller.assignedProducts?.length) {
    return res.json([])
  }

  query = {
    _id: {
      $in: seller.assignedProducts.map(
        id => new mongoose.Types.ObjectId(id)
      )
    }
  }
}

      /* ================= USER ================= */
if (req.user.role === "user") {
  const userDoc = await User.findById(req.user.id)

  if (!userDoc || !userDoc.assignedProducts?.length) {
    return res.json([])
  }

  query = {
    _id: {
      $in: userDoc.assignedProducts.map(
        id => new mongoose.Types.ObjectId(id)
      )
    }
  }
}

  // ✅🔥 YAHI PE ADD KARO
      console.log("ROLE:", req.user.role)
      console.log("QUERY:", query)
      
      const dbProducts = await Product.find(query).sort({ createdAt: -1 })

      res.json(dbProducts)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)



/* =====================================================
   PUBLIC PRODUCTS (NO LOGIN)
===================================================== */
app.get("/products/public", async (req, res) => {
  try {
    const products = await Product.find({
      $or: [
        { distributorId: null },
        { distributorId: { $exists: false } }
      ]
    }).sort({ createdAt: -1 })

    res.json(products)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})
/* =====================================================
   REQUEST SYSTEM
===================================================== */

app.post("/requests/create", protect, async (req, res) => {
  try {

    /* ⭐ NEW PRODUCT FIELDS */
    const { type, name, email, phone, address, productIds, assignAllProducts, requestedForId, idType, idNumber } = req.body

    if (!type || !name || !email) {
      return res.status(400).json({ message: "All fields required" })
    }

    /* ⭐ Aadhar / PAN — koi ek zaroori hai, aur unique hona chahiye */
    const idCheck = validateIdNumber(idType, idNumber)
    if (!idCheck.valid) {
      return res.status(400).json({ message: idCheck.message })
    }
    const cleanIdNumber = idCheck.value

    // ⭐ Already kisi User ke paas ye ID hai?
    const idInUse = await User.findOne({ idNumber: cleanIdNumber })
    if (idInUse) {
      return res.status(409).json({ message: "Ye Aadhar/PAN number already kisi account se linked hai" })
    }

    // ⭐ Kisi pending request mein bhi to nahi use ho raha?
    const idInPendingRequest = await UserRequest.findOne({ idNumber: cleanIdNumber, status: "pending" })
    if (idInPendingRequest) {
      return res.status(409).json({ message: "Ye Aadhar/PAN number ki request pehle se pending hai" })
    }

    /* ── Role-based type validation ── */
    if (req.user.role === "distributor") {
      // requestedFor ki role ke hisaab se type check karo
      if (requestedForId) {
        const forUser = await User.findById(requestedForId).select("role")
        const forRole = forUser?.role
        if (forRole === "distributor" && !["distributor","seller"].includes(type)) {
          return res.status(403).json({ message: "Distributor ke liye sirf Distributor ya Seller bana sakte hain" })
        }
        if (forRole === "seller" && !["seller","user"].includes(type)) {
          return res.status(403).json({ message: "Seller ke liye sirf Seller ya User bana sakte hain" })
        }
        if (forRole === "user" && type !== "user") {
          return res.status(403).json({ message: "User ke liye sirf User bana sakte hain" })
        }
      } else {
        // Apne liye — sirf distributor ya seller
        if (!["distributor","seller"].includes(type)) {
          return res.status(403).json({ message: "Distributor apne liye sirf Distributor ya Seller bana sakta hai — User nahi" })
        }
      }
    }
    if (req.user.role === "seller") {
      if (!requestedForId) {
        if (!["seller","user"].includes(type)) {
          return res.status(403).json({ message: "Seller sirf Seller ya User bana sakta hai" })
        }
      } else {
        const forUser = await User.findById(requestedForId).select("role")
        const forRole = forUser?.role
        if (forRole === "user" && type !== "user") {
          return res.status(403).json({ message: "User ke liye sirf User bana sakte hain" })
        }
        if (!["seller","user"].includes(type)) {
          return res.status(403).json({ message: "Seller sirf Seller ya User bana sakta hai" })
        }
      }
    }
    if (req.user.role === "user") {
      if (type !== "user") {
        return res.status(403).json({ message: "User sirf User bana sakta hai" })
      }
    }

    const request = await UserRequest.create({
      requestedBy: req.user.id,
      requestedForId: requestedForId || null,   // ⭐ jiske liye request hai
      type,
      name,
      email,
      phone: phone || "",
      address: address || "",
      idType,
      idNumber: cleanIdNumber,
      status: "pending",

      /* ⭐ NEW */
      assignedProducts: productIds
        ? productIds.map(id => new mongoose.Types.ObjectId(id))
        : [],
      assignAllProducts: assignAllProducts || false
    })

    // 🔔 Notification — sirf Admin ko batao ki nayi request aayi hai
    try {
      console.log("🔔 [DEBUG] Notification block start. req.user:", req.user)
      const requester = await User.findById(req.user.id).select("name role")
      console.log("🔔 [DEBUG] requester found:", requester)
      const admins     = await User.find({ role: "admin", isDeleted: { $ne: true } }).select("_id")
      console.log("🔔 [DEBUG] admins found:", admins.length, admins.map(a => a._id))
      const adminIds   = admins.map(a => a._id)
      await notifyNewUserRequest({
        request,
        requesterName: requester?.name || "Someone",
        requesterRole: requester?.role || req.user.role,
        adminIds,
      })
      console.log("🔔 [DEBUG] notifyNewUserRequest completed successfully")
    } catch (ne) { console.error("❌ [DEBUG] Notif error:", ne.message, ne.stack) }

    res.json(request)

  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

app.get("/requests/all", protect, allowRoles("admin"), async (req, res) => {
  try {

    const requests = await UserRequest.find({
      status: "pending",
      type: { $ne: "password-reset" }   // ⭐ IMPORTANT FIX
    })
      .populate("requestedBy", "name email role")
      .populate("requestedForId", "name role")

    res.json(requests)

  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   PASSWORD RESET REQUEST (USER SIDE)
===================================================== */

app.post("/password-help", async (req, res) => {
  try {

    const { email, whatsapp } = req.body

    if (!email || !whatsapp) {
      return res.status(400).json({
        success: false,
        message: "Email and WhatsApp required"
      })
    }

    const cleanEmail = email.trim().toLowerCase()

    const user = await User.findOne({ email: cleanEmail })

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      })
    }

    const request = await UserRequest.create({
      requestedBy: user._id,
      type: "password-reset",
      name: user.name,
      email: cleanEmail,
      whatsapp,
      status: "pending"
    })

    console.log("🔑 Password reset request created")

    res.json({
      success: true,
      message: "Request sent to admin"
    })

  } catch (err) {
    console.error("Password help error:", err)
    res.status(500).json({
      success: false,
      message: "Server error"
    })
  }
})

/*========================================================
   Request raiser ko approved list
=======================================================*/


app.get("/requests/my", protect, async (req, res) => {
  try {
    // ⭐ Dono: jo tune banaya + jo tere liye banaya gaya
    const requests = await UserRequest.find({
      $or: [
        { requestedBy:   req.user.id, status: "approved" },
        { requestedForId: req.user.id, status: "approved" }
      ]
    })
      .populate("requestedBy",   "name role")
      .populate("requestedForId", "name role")
      .sort({ updatedAt: -1 })

    res.json(requests)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})
/*==========================================================
        Pending API
=========================================================*/
app.get("/requests/pending", protect, allowRoles("admin"), async (req, res) => {
  try {

    const requests = await UserRequest.find({
      status: "pending",
      type: { $ne: "password-reset" }   // ⭐ IMPORTANT FIX
    })
      .populate("requestedBy", "name email role")
      .populate("requestedForId", "name role")

    res.json(requests)

  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   PASSWORD RESET REQUESTS (ADMIN)
===================================================== */

app.get(
  "/requests/password-reset",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const requests = await UserRequest.find({
        type: "password-reset",
        status: "pending"
      }).sort({ createdAt: -1 })

      res.json(requests)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
/*=========================================================

                     History API

========================================================*/

app.get("/requests/history", protect, allowRoles("admin"), async (req, res) => {
  try {
    const requests = await UserRequest.find({ status: { $ne: "pending" } })
      .populate("requestedBy", "name email role")
      .populate("requestedForId", "name role")

    res.json(requests)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

      /* =====================================================
   ADD PRODUCT (MONGODB FINAL VERSION)
===================================================== */
app.post(
  "/admin/add-product",
  protect,
  allowRoles("admin"),
  upload.single("image"),
  async (req, res) => {
    try {

      console.log("🔥 ADD PRODUCT BODY:", req.body)
      console.log("🔥 FILE:", req.file)

     const { title, price, ppcReward, assignAllUsers, userIds, category, description } = req.body  // ⭐ category + description added

      if (!title || !price) {
        return res.status(400).json({ message: "Title & Price required" })
      }

      const newProduct = await Product.create({
        title: String(title).trim(),
        price: Number(price),
        ppcReward: Number(ppcReward) || 1,  // ⭐ NEW - Default 1 PPC
        category: category ? String(category).trim() : "",
        description: description ? String(description).trim() : "",  // ⭐ NEW - description ab save hoga
        image: req.file ? req.file.filename : "",
        distributorId: null
      })

      console.log("✅ PRODUCT SAVED:", newProduct.title, `(${newProduct.ppcReward} PPC)`)  // ⭐ Show PPC

      /* =====================================================
         ⭐ AUTO ASSIGN PRODUCT TO USERS (UNCHANGED)
      ===================================================== */

      try {

        const assignAll =
          assignAllUsers === true ||
          assignAllUsers === "true"

        /* ⭐ ALL USERS */
        if (assignAll) {

          console.log("🔥 Assigning product to ALL users")

          await User.updateMany(
            { role: { $in: ["seller", "distributor", "user"] } },
            { $addToSet: { assignedProducts: newProduct._id } }
          )
        }

        /* ⭐ SPECIFIC USERS */
        else {

          const ids =
            typeof userIds === "string"
              ? JSON.parse(userIds)
              : (Array.isArray(userIds) ? userIds : [])

          if (Array.isArray(ids) && ids.length > 0) {

            console.log("🔥 Assigning to users:", ids)

            await User.updateMany(
              { _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } },
              { $addToSet: { assignedProducts: newProduct._id } }
            )
          }

        }

      } catch (assignErr) {
        console.error("❌ Assign error:", assignErr.message)
      }

      res.json(newProduct)

    } catch (err) {
      console.error("❌ ADD PRODUCT ERROR:", err)
      res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   ADMIN DELETE PRODUCT EVERYWHERE
===================================================== */
app.delete(
  "/admin/delete-product/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {

    const productId = req.params.id

    await Product.findByIdAndDelete(productId)

    await User.updateMany(
      {},
      { $pull: { assignedProducts: productId } }
    )

    res.json({ success: true })
  }
)

/* =====================================================
   REMOVE PRODUCT FROM SPECIFIC USERS
===================================================== */
app.put(
  "/admin/remove-product-users/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {

    const { userIds } = req.body

    await User.updateMany(
      { _id: { $in: userIds } },
      { $pull: { assignedProducts: req.params.id } }
    )

    res.json({ success: true })
  }
)
/* =====================================================
   ADMIN → ADD PRODUCT TO SPECIFIC USERS  ⭐ NEW
   PUT /admin/add-product-users/:id
===================================================== */
app.put(
  "/admin/add-product-users/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const productId = req.params.id
      const { userIds } = req.body

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "userIds array required" })
      }

      await User.updateMany(
        { _id: { $in: userIds } },
        { $addToSet: { assignedProducts: new mongoose.Types.ObjectId(productId) } }
      )

      return res.json({
        success: true,
        message: `Product added to ${userIds.length} user(s)`
      })

    } catch (err) {
      console.error("Add product to users error:", err)
      return res.status(500).json({ message: err.message })
    }
  }
)

/* =====================================================
   USER CREATION
===================================================== */
app.post(
  "/users/create",
  protect,
  allowRoles("admin", "distributor", "seller"),
  async (req, res) => {
    try {
      const { parentId, email, password, role, assignedProducts } = req.body

      /* ── Role-based creation rules ── */
      if (req.user.role === "distributor") {
        // Distributor → sirf distributor ya seller bana sakta hai, user nahi
        if (!["distributor", "seller"].includes(role)) {
          return res.status(403).json({
            message: "Distributor sirf Distributor ya Seller bana sakta hai"
          })
        }
      }

      if (req.user.role === "seller") {
        // Seller → sirf seller ya user bana sakta hai
        if (!["seller", "user"].includes(role)) {
          return res.status(403).json({
            message: "Seller sirf Seller ya User bana sakta hai"
          })
        }
      }

      const exists = await User.findOne({ email })
      if (exists) {
        return res.status(409).json({
          message: "Email already exists"
        })
      }

      // ⭐ Actual parentId decide karo
      const actualParentId =
        req.user.role === "admin"
          ? (parentId ? parentId : null)
          : req.user.id

      // ⭐ Parent ka name lo
      // ⭐ FIX: Agar parent admin hai to prefix mat lagao
      let parentName = null
      if (actualParentId) {
        const parentUser = await User.findById(actualParentId).select("name role").lean()
        if (parentUser && parentUser.role !== "admin") {
          parentName = parentUser.name
        }
      }

      // ⭐ Auto name generate: e.g. "DB004/DS001" ya "DS001/US001"
      const autoName = await generateUserId(role, User, parentName)

      const hashed = await bcrypt.hash(password, 10)

      const newUser = await User.create({
        name: autoName,
        email,
        password: hashed,
        role,
        parentId: actualParentId,

        // 🔥 FIX: convert string → ObjectId (UNTOUCHED)
        assignedProducts: assignedProducts
          ? assignedProducts.map(
              id => new mongoose.Types.ObjectId(id)
            )
          : []
      })

      res.json({
        success: true,
        user: {
          id: String(newUser._id),
          name: newUser.name,
          role: newUser.role
        }
      })

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)



app.get(
  "/users/all-for-product",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const users = await User.find({
        role: { $in: ["seller", "distributor", "user"] }
      })
        .select("name fullName email role phone address parentId isBlocked isDeleted blockedAt deletedAt createdAt")
        .sort({ createdAt: -1 })
        .lean()

      return res.json(users)

    } catch (err) {
      console.error("Get users error:", err)
      return res.status(500).json({ message: "Failed to fetch users" })
    }
  }
)

/* =====================================================
   ADMIN → BLOCK USER
   ✔ Prevent double block
   ✔ Prevent block deleted user
   ✔ Prevent self block
===================================================== */

app.put(
  "/admin/block-user/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      if (String(req.user.id) === String(id))
        return res.status(400).json({ message: "Admin cannot block self" })

      const user = await User.findById(id)

      if (!user)
        return res.status(404).json({ message: "User not found" })

      if (user.isDeleted)
        return res.status(400).json({ message: "Cannot block deleted user" })

      if (user.isBlocked)
        return res.status(400).json({ message: "User already blocked" })

      user.isBlocked = true
      user.blockedReason = req.body?.reason || "Blocked by admin"
      user.blockedAt = new Date()

      await user.save()

      return res.json({
        success: true,
        message: "User blocked",
        userId: user._id,
        isBlocked: true
      })

    } catch (err) {
      console.error("Block error:", err)
      return res.status(500).json({ message: "Failed to block user" })
    }
  }
)
/* =====================================================
   ADMIN → RESET USER PASSWORD (TEMP PASSWORD)
===================================================== */

app.put(
  "/admin/reset-password/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "Invalid user id"
        })
      }

      const user = await User.findById(id).select("+password")

      if (!user) {
        return res.status(404).json({
          message: "User not found"
        })
      }

      /* 🔥 TEMP PASSWORD GENERATE */
      const tempPassword = crypto.randomBytes(4).toString("hex")

      const hashed = await bcrypt.hash(tempPassword, 10)

      user.password = hashed
      user.mustChangePassword = true

      await user.save()

      console.log("🔑 TEMP PASSWORD GENERATED:", tempPassword)

      return res.json({
        success: true,
        tempPassword
      })

    } catch (err) {
      console.error("Reset password error:", err)
      return res.status(500).json({
        message: "Failed to reset password"
      })
    }
  }
)
/* =====================================================
   ADMIN → APPROVE PASSWORD RESET REQUEST
   (Approve dabate hi request complete ho jayegi)
===================================================== */

app.post(
  "/requests/approve-reset/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const request = await UserRequest.findById(req.params.id)

      if (!request) {
        return res.status(404).json({
          message: "Request not found"
        })
      }

      request.status = "approved"
      request.approvedAt = new Date()

      await request.save()

      console.log("✅ Password reset request approved")

      res.json({
        success: true
      })

    } catch (err) {
      console.error("Approve reset error:", err)

      res.status(500).json({
        message: "Failed to approve request"
      })
    }
  }
)

/* =====================================================
   ADMIN → UNBLOCK USER
   ✔ Prevent double unblock
===================================================== */

app.put(
  "/admin/unblock-user/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      const user = await User.findById(id)

      if (!user)
        return res.status(404).json({ message: "User not found" })

      if (!user.isBlocked)
        return res.status(400).json({ message: "User already active" })

      user.isBlocked = false
      user.blockedReason = null
      user.blockedAt = null

      await user.save()

      return res.json({
        success: true,
        message: "User unblocked",
        userId: user._id,
        isBlocked: false
      })

    } catch (err) {
      console.error("Unblock error:", err)
      return res.status(500).json({ message: "Failed to unblock user" })
    }
  }
)



/* =====================================================
   ADMIN → DELETE USER (SOFT DELETE)
   ✔ Prevent double delete
   ✔ Auto block
   ✔ Prevent self delete
===================================================== */

app.delete(
  "/admin/delete-user/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      if (String(req.user.id) === String(id))
        return res.status(400).json({ message: "Admin cannot delete self" })

      const user = await User.findById(id)

      if (!user)
        return res.status(404).json({ message: "User not found" })

      if (user.isDeleted)
  return res.status(400).json({ message: "User already deleted" })

        // ⭐ CASCADE REASSIGN — children ko grandparent se connect karo
        const grandParentId = user.parentId || null
        const children = await User.find({ parentId: user._id })

        if (children.length > 0) {
          await User.updateMany(
            { parentId: user._id },
            { $set: { parentId: grandParentId } }
          )
          if (grandParentId) {
            const childIds = children.map(c => c._id)
            const Order = mongoose.model("Order")
            await Order.updateMany(
              { sellerId: { $in: childIds }, status: "pending" },
              { $set: { distributorId: grandParentId } }
            )
          }
        }

        user.isDeleted = true
        user.deletedAt = new Date()

        /* 🔥 Auto block when deleted */
        user.isBlocked = true
        user.blockedAt = new Date()

        await user.save()

        return res.json({
          success: true,
          message: "User soft deleted",
          userId: user._id,
          isDeleted: true,
          childrenReassigned: children.length,
          newParentId: grandParentId
        })

    } catch (err) {
      console.error("Delete error:", err)
      return res.status(500).json({ message: "Failed to delete user" })
    }
  }
)



/* =====================================================
   ADMIN → RESTORE USER
   ✔ Prevent restore active user
===================================================== */

app.put(
  "/admin/restore-user/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      const user = await User.findById(id)

      if (!user)
        return res.status(404).json({ message: "User not found" })

      if (!user.isDeleted)
        return res.status(400).json({ message: "User is not deleted" })

      user.isDeleted = false
      user.deletedAt = null
      user.isBlocked = false
      user.blockedAt = null

      await user.save()

      return res.json({
        success: true,
        message: "User restored",
        userId: user._id
      })

    } catch (err) {
      console.error("Restore error:", err)
      return res.status(500).json({ message: "Failed to restore user" })
    }
  }
)

/* =====================================================
   ADMIN → CHANGE USER PARENT (RECONNECT)
   PUT /admin/change-parent/:id
===================================================== */
app.put(
  "/admin/change-parent/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params
      const { newParentId } = req.body

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      if (newParentId && !mongoose.Types.ObjectId.isValid(newParentId))
        return res.status(400).json({ message: "Invalid newParentId" })

      const user = await User.findById(id)
      if (!user) return res.status(404).json({ message: "User not found" })

      if (String(id) === String(newParentId))
        return res.status(400).json({ message: "User cannot be own parent" })

      user.parentId = newParentId || null

      // ⭐ Name update — generateUserId se fresh unique naam milega
      try {
        let parentName = null
        if (newParentId) {
          const newParentUser = await User.findById(newParentId).select("name role")
          if (newParentUser && newParentUser.role !== "admin") {
            parentName = newParentUser.name
          }
        }

        // ⭐ generateUserId se unique naam generate karo
        // Pehle current user ka naam temporarily hatao taaki uska apna number reuse na ho
        const oldName = user.name
        user.name = "__temp_rename__"
        await user.save()

        const newName = await generateUserId(user.role, User, parentName)
        user.name = newName

        console.log(`✅ Name changed: ${oldName} → ${newName}`)
      } catch (nameErr) {
        console.error("Name update error:", nameErr.message)
      }

      // ⭐ Final save with new name + parentId
      await user.save()

      // ⭐ Purane PENDING orders bhi new distributor ke paas bhejo
      try {
        const findNearestDist = async (userId) => {
          if (!userId) return null
          const p = await User.findById(userId).select("role parentId isDeleted")
          if (!p || p.isDeleted) return null
          if (p.role === "distributor") return p._id
          if (p.role === "admin") return null
          return findNearestDist(p.parentId)
        }

        const newDistId = await findNearestDist(user._id)

        if (newDistId) {
          const updated = await Order.updateMany(
            { sellerId: user._id, status: "pending" },
            { $set: { distributorId: newDistId } }
          )
          console.log("✅ Pending orders updated:", updated.modifiedCount)
        }
      } catch (orderErr) {
        console.error("Order update error:", orderErr.message)
      }

      const newParent = newParentId
        ? await User.findById(newParentId).select("name role")
        : null

      return res.json({
        success: true,
        message: "Parent updated",
        newParent: newParent
          ? { id: newParent._id, name: newParent.name, role: newParent.role }
          : null
      })
    } catch (err) {
      console.error("Change parent error:", err)
      return res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   ADMIN → PERMANENT DELETE USER
   ⚠️ Must be soft deleted first
   ✔ Prevent accidental delete
===================================================== */

app.delete(
  "/admin/permanent-delete-user/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {

      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid user id" })

      const user = await User.findById(id)

      if (!user)
        return res.status(404).json({ message: "User not found" })

      if (!user.isDeleted)
  return res.status(400).json({
    message: "User must be soft deleted first"
  })

      // ⭐ CASCADE REASSIGN on permanent delete (safety ke liye dobara)
      const grandParentId2 = user.parentId || null
      const children2 = await User.find({ parentId: user._id })

      if (children2.length > 0) {
        await User.updateMany(
          { parentId: user._id },
          { $set: { parentId: grandParentId2 } }
        )
        if (grandParentId2) {
          const childIds2 = children2.map(c => c._id)
          const Order = mongoose.model("Order")
          await Order.updateMany(
            { sellerId: { $in: childIds2 }, status: "pending" },
            { $set: { distributorId: grandParentId2 } }
          )
        }
      }

      await User.findByIdAndDelete(id)

      return res.json({
        success: true,
        message: "User permanently deleted",
        childrenReassigned: children2.length,
        newParentId: grandParentId2
      })

          } catch (err) {
            console.error("Permanent delete error:", err)
            return res.status(500).json({
              message: "Failed to permanently delete user"
            })
          }
        }
      )
/* =====================================================
   ⭐ GET MY WALLET
===================================================== */
app.get("/users/wallet/me", protect, async (req, res) => {
  try {

    console.log("🪙 Wallet request by:", req.user?.id)

    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized" })
    }

    const user = await User.findById(req.user.id)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    const history = await Commission.find({
      toUser: user._id
    })
      .populate("fromUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })
      .limit(50)

    res.json({
      coinBalance: user.coinBalance || 0,
      walletBalance: user.walletBalance || 0,
      totalCommissionEarned: user.totalCommissionEarned || 0,
      totalCoinEarned: user.totalCoinEarned || 0,
      history
    })

  } catch (err) {
    console.error("Wallet error:", err.message)
    res.status(500).json({ message: err.message })
  }
})

/*=====================================================
   Admin Approve → Auto Create User + Temp Password
=====================================================*/

app.post("/requests/approve/:id", protect, allowRoles("admin"), async (req, res) => {
  try {

    console.log("🔥 APPROVE REQUEST ID =", req.params.id)
    console.log("🔥 USER =", req.user?.id, req.user?.role)

    const { productIds, assignAllProducts } = req.body

    const request = await UserRequest.findById(req.params.id)
    if (!request) return res.status(404).json({ message: "Request not found" })

    if (request.status === "approved")
      return res.status(400).json({ message: "Already approved" })

    if (request.status === "rejected")
      return res.status(400).json({ message: "Already rejected" })

    const cleanEmail = request.email.trim().toLowerCase()
    const exists = await User.findOne({ email: cleanEmail })
    if (exists) return res.status(409).json({ message: "User already exists" })

    // ⭐ Safety re-check — approval ke waqt bhi Aadhar/PAN unique hona chahiye
    if (request.idNumber) {
      const idTaken = await User.findOne({ idNumber: request.idNumber })
      if (idTaken) {
        return res.status(409).json({ message: "Ye Aadhar/PAN number already kisi aur account se linked ho chuka hai" })
      }
    }

    // ⭐ parentId decide karo:
    // requestedForId → jiske liye request thi (selected member)
    // fallback → requestedBy (jo request kiya)
    const actualParentId = request.requestedForId || request.requestedBy || null

    let parentName = null
    if (actualParentId) {
      const parentUser = await User.findById(actualParentId).select("name role").lean()
      if (parentUser && parentUser.role !== "admin") {
        parentName = parentUser.name
      }
    }

    // ⭐ Auto name generate based on actual parent
    const autoName = await generateUserId(request.type, User, parentName)

    const tempPass = crypto.randomBytes(4).toString("hex")
    const hashed = await bcrypt.hash(tempPass, 10)

    // ⭐ PRODUCTS LOGIC (UNTOUCHED)
    let assignedProducts = []

if (assignAllProducts) {
  assignedProducts = await Product.find().distinct("_id")
}
else if (productIds?.length) {
  assignedProducts = productIds.map(id => new mongoose.Types.ObjectId(id))
}
else if (request.assignAllProducts) {
  assignedProducts = await Product.find().distinct("_id")
}
// ⭐ FIX: Last fallback hataya — admin ne select nahi kiya to koi product nahi milega
// else if (request.assignedProducts?.length) { ... }  ← REMOVED

    const newUser = await User.create({
      name: autoName,
      email: cleanEmail,
      password: hashed,
      role: request.type,
      parentId: actualParentId,   // ⭐ selected member ke niche create hoga
      mustChangePassword: true,
      assignedProducts,
      fullName: request.name || "",
      phone: request.phone || "",
      address: request.address || "",
      idType: request.idType || "",
      idNumber: request.idNumber || null
    })

    request.status           = "approved"
    request.approvedAt       = new Date()
    request.createdUserId    = newUser._id
    request.createdUserName  = newUser.name
    request.createdUserEmail = newUser.email
    request.tempPassword     = tempPass
    await request.save()

    // 🔔 Notification — requester + requestedFor (jiske liye tha) ko batao
    try {
      await notifyRequestApproved({
        request,
        requesterId: request.requestedBy,
        requestedForId: request.requestedForId,
        newUserName: newUser.name,
      })
    } catch (ne) { console.error("Notif error:", ne.message) }

    res.json({
      success: true,
      tempPassword: tempPass,
      user: { id: newUser._id, name: newUser.name, email: newUser.email }
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   ADMIN → REJECT REQUEST
===================================================== */

app.post("/requests/reject/:id", protect, allowRoles("admin"), async (req, res) => {
  try {

    console.log("🔥 REJECT REQUEST ID =", req.params.id)   // ⭐ DEBUG

    const request = await UserRequest.findById(req.params.id)

    if (!request)
      return res.status(404).json({ message: "Request not found" })

    request.status = "rejected"
    request.rejectedAt = new Date()  // ⭐ NEW - reject time bhi record karo
    await request.save()

    // 🔔 Notification — requester + requestedFor ko batao
    try {
      await notifyRequestRejected({
        request,
        requesterId: request.requestedBy,
        requestedForId: request.requestedForId,
      })
    } catch (ne) { console.error("Notif error:", ne.message) }

    console.log("🔥 REQUEST REJECTED")

    return res.json({ success: true })

  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   SELLER → MY ASSIGNED PRODUCTS
===================================================== */
app.get(
  "/products/mine",
  protect,
  allowRoles("seller"),
  async (req, res) => {
    try {
      const seller = await User.findById(req.user.id)

      if (!seller) {
        return res.status(404).json({ message: "Seller not found" })
      }

      // If no assignment → show empty
      if (!seller.assignedProducts || seller.assignedProducts.length === 0) {
        return res.json([])
      }

      const assignedProducts = await Product.find({
        _id: { $in: seller.assignedProducts }
      })

      res.json(assignedProducts)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   NETWORK TREE (FINAL FIXED)
===================================================== */
app.get(
  "/users/tree",
  protect,
  allowRoles("admin","distributor","seller","user"),
  async (req, res) => {

    try {

      const users = await User.find().lean()

      /* =====================================================
         BUILD TREE FUNCTION
      ===================================================== */

      const buildTree = (parentId) => {

        const children = users.filter(
          u => String(u.parentId) === String(parentId)
        )

        return children.map(user => {

          const childNodes = buildTree(String(user._id))

          return {
            id: String(user._id),
            name: user.name,
            role: user.role,
            children: childNodes
          }

        })

      }

      /* =====================================================
         ADMIN → FULL TREE
      ===================================================== */

      if (req.user.role === "admin") {
  const adminUser = users.find(u => u.role === "admin")
  const adminId = adminUser ? String(adminUser._id) : null

  // Non-admin users
  const nonAdminUsers = users.filter(u => u.role !== "admin")

  // Saare non-admin user IDs
  const nonAdminIds = new Set(nonAdminUsers.map(u => String(u._id)))

  // Recursive tree builder
  const buildAdminTree = (parentId) => {
    return nonAdminUsers
      .filter(u => String(u.parentId) === String(parentId))
      .map(u => ({
        id: String(u._id),
        name: u.name,
        role: u.role,
        children: buildAdminTree(String(u._id))
      }))
  }

  // Top-level children of admin:
  // 1. parentId matches adminId
  // 2. parentId is null/undefined/empty
  // 3. parentId points to admin user
  // 4. parentId points to non-existent user (orphan)
  const topLevel = nonAdminUsers.filter(u => {
    const pid = u.parentId ? String(u.parentId) : null
    if (!pid || pid === "null" || pid === "") return true      // no parent
    if (adminId && pid === adminId) return true                // direct admin child
    if (!nonAdminIds.has(pid)) return true                     // orphan
    return false
  })

  console.log(`🌳 Admin tree: total=${nonAdminUsers.length}, topLevel=${topLevel.length}, adminId=${adminId}`)
  nonAdminUsers.forEach(u => console.log(`  user: ${u.name} parentId=${u.parentId} _id=${u._id}`))

  const adminChildren = topLevel.map(u => ({
    id: String(u._id),
    name: u.name,
    role: u.role,
    children: buildAdminTree(String(u._id))
  }))

  const tree = [{
    id: adminId || "admin",
    name: adminUser?.name || "Admin",
    role: "admin",
    children: adminChildren
  }]

  return res.json(tree)
}

      /* =====================================================
         DISTRIBUTOR / SELLER → ONLY THEIR TREE
      ===================================================== */

      const me = users.find(
        u => String(u._id) === String(req.user.id)
      )

      if (!me) return res.json([])

      const myTree = [{
        id: String(me._id),
        name: me.name,
        role: me.role,
        children: buildTree(String(me._id))
      }]

      return res.json(myTree)

    } catch (err) {

      console.error("Tree error:", err)

      res.status(500).json({
        message: err.message
      })

    }

  }
)
/* =====================================================
   DISTRIBUTOR → OWN SELLERS
===================================================== */
app.get(
  "/users/my-sellers",
  protect,
  allowRoles("distributor"),
  async (req, res) => {
    const sellers = await User.find({
      role: "seller",
      parentId: String(req.user.id)
    })

    res.json(sellers)
  }
)

/* =====================================================
   SELLER → OWN SELLERS + USERS (direct children)
===================================================== */
app.get(
  "/users/my-children",
  protect,
  allowRoles("seller"),
  async (req, res) => {
    try {
      const children = await User.find({
        role: { $in: ["seller", "user"] },
        parentId: req.user.id
      }).select("name email role isBlocked isDeleted createdAt assignedProducts")

      res.json(children)
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

/* =====================================================
   ORDER SYSTEM (APPROVAL FLOW)
===================================================== 

app.post(
  "/orders",
  protect,
  allowRoles("seller"),
  async (req, res) => {
    try {
      const seller = await User.findById(req.user.id)
      if (!seller) {
        return res.status(404).json({ message: "Seller not found" })
      }

      const order = await Order.create({
        sellerId: seller._id,
        distributorId: seller.parentId || null,
        items: req.body.items || [],
        total: req.body.total,
        customerName: req.body.customerName,
        phone: req.body.phone,
        address: req.body.address,
        status: "pending"
      })

      res.json(order)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

app.get(
  "/orders/pending",
  protect,
  allowRoles("distributor"),
  async (req, res) => {
    try {
      const orders = await Order.find({
        distributorId: req.user.id,
        status: "pending"
      })
        .populate("sellerId", "name")
        .sort({ createdAt: -1 })

      res.json(orders)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

app.put(
  "/orders/confirm/:id",
  protect,
  allowRoles("distributor"),
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id)
      if (!order) {
        return res.status(404).json({ message: "Order not found" })
      }

      if (order.status !== "pending") {
        return res.status(400).json({ message: "Already processed" })
      }

      order.status = "confirmed"
      order.confirmedAt = new Date()
      await order.save()

      

      const seller = await User.findById(order.sellerId)
      if (seller) {
        seller.sales = (seller.sales || 0) + order.total
        await seller.save()

        if (seller.sales >= 50000 && seller.role === "seller") {
          seller.role = "distributor"
          await seller.save()
        }
      }

      res.json(order)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
*/
/* =====================================================
   DISTRIBUTOR → ALL MY ORDERS (HISTORY)
===================================================== */
app.get(
  "/orders/distributor",
  protect,
  allowRoles("distributor"),
  async (req, res) => {
    try {
      const orders = await Order.find({
        distributorId: req.user.id
      })
        .populate("sellerId", "name")
        .sort({ createdAt: -1 })

      res.json(orders)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   SELLER → MY ORDERS
===================================================== */
app.get(
  "/orders/mine",
  protect,
  allowRoles("seller", "user"),
  async (req, res) => {
    try {
      const orders = await Order.find({
        sellerId: new mongoose.Types.ObjectId(req.user.id)
      }).sort({ createdAt: -1 })

      res.json(orders)

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

/* =====================================================
   🔥 ENTERPRISE ANALYTICS API
===================================================== */
app.get(
  "/analytics/user/:id",
  protect,
  async (req, res) => {
    try {
      const { range = "lifetime" } = req.query
      const userId = String(req.params.id)

      let startDate = null
      const now = new Date()

      if (range === "today")
        startDate = new Date(now.setHours(0, 0, 0, 0))
      if (range === "week")
        startDate = new Date(Date.now() - 7 * 86400000)
      if (range === "month")
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      if (range === "year")
        startDate = new Date(now.getFullYear(), 0, 1)

      const orderQuery = { sellerId: userId, status: "confirmed" }
if (startDate) orderQuery.createdAt = { $gte: startDate }
const orders = await Order.find(orderQuery)

const totalSales = orders.reduce((s, o) => s + o.total, 0)

const timelineMap = {}
orders.forEach(o => {
  const label = new Date(o.createdAt).toLocaleDateString()
  if (!timelineMap[label]) timelineMap[label] = 0
  timelineMap[label] += o.total
})
const timeline = Object.keys(timelineMap).map(key => ({
  label: key, total: timelineMap[key]
}))

// Sub-users count (recursive)
const countSubUsers = async (parentId) => {
  const direct = await User.find({ parentId: new mongoose.Types.ObjectId(parentId), isDeleted: { $ne: true } }).select("_id")
  let total = direct.length
  for (const child of direct) {
    total += await countSubUsers(child._id)
  }
  return total
}
const subUsersCount = await countSubUsers(userId)

// Direct children
const directChildren = await User.find({
  parentId: new mongoose.Types.ObjectId(userId),
  isDeleted: { $ne: true }
}).select("name role email isBlocked")

// ⭐ ALL sub users (recursive flat list)
const getAllSubUsers = async (parentId) => {
  const direct = await User.find({
    parentId: new mongoose.Types.ObjectId(String(parentId)),
    isDeleted: { $ne: true }
  }).select("name role isBlocked")
  let all = [...direct]
  for (const child of direct) {
    const nested = await getAllSubUsers(child._id)
    all = [...all, ...nested]
  }
  return all
}
const allSubUsers = await getAllSubUsers(userId)

// Assigned products
const targetUser = await User.findById(userId).select("assignedProducts role name")
let assignedProducts = []
if (targetUser?.assignedProducts?.length) {
  assignedProducts = await Product.find({
    _id: { $in: targetUser.assignedProducts }
  }).select("title price")
}

// Top selling product
const productSalesMap = {}
orders.forEach(o => {
  (o.items || []).forEach(item => {
    const pid = String(item.productId || item._id || "unknown")
    const name = item.title || item.name || null   // ⭐ ID ko fallback mat banao
    if (!productSalesMap[pid]) productSalesMap[pid] = { name, total: 0, count: 0 }
    else if (!productSalesMap[pid].name && name) productSalesMap[pid].name = name
    productSalesMap[pid].total += (item.price || 0) * (item.qty || item.quantity || 1)
    productSalesMap[pid].count += (item.qty || item.quantity || 1)
  })
})

// ⭐ Jinke items mein naam save nahi tha (purane orders), unke liye
// Product collection se seedha title nikaal lo — taaki kabhi ID na dikhe
const idsNeedingLookup = Object.keys(productSalesMap)
  .filter(pid => !productSalesMap[pid].name && mongoose.Types.ObjectId.isValid(pid))
if (idsNeedingLookup.length) {
  const lookedUp = await Product.find({ _id: { $in: idsNeedingLookup } }).select("title")
  lookedUp.forEach(p => {
    if (productSalesMap[String(p._id)]) productSalesMap[String(p._id)].name = p.title
  })
}
// Ab bhi kuch bache (product delete ho chuka ho) to hi ek generic label do
Object.values(productSalesMap).forEach(p => { if (!p.name) p.name = "Deleted Product" })

const topProduct = Object.values(productSalesMap).sort((a, b) => b.total - a.total)[0] || null

res.json({
  ordersCount: orders.length,
  totalSales,
  timeline,
  subUsersCount,
  directChildren,
  assignedProducts,
  topProduct,
  allSubUsers,
  userName: targetUser?.name,
  userRole: targetUser?.role
})

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   DISTRIBUTOR → ASSIGN PRODUCTS TO SELLER
===================================================== */

app.put(
  "/users/assign-products/:sellerId",
  protect,
  allowRoles("distributor"),
  async (req, res) => {
    try {
      const { sellerId } = req.params
      const { productIds } = req.body

      const seller = await User.findById(sellerId)

      if (!seller) {
        return res.status(404).json({ message: "Seller not found" })
      }

      if (String(seller.parentId) !== String(req.user.id)) {
        return res.status(403).json({
          message: "You can assign only your own sellers"
        })
      }

      // 🔥🔥🔥 IMPORTANT FIX HERE
      seller.assignedProducts = productIds
        ? productIds.map(
            id => new mongoose.Types.ObjectId(id)
          )
        : []

      await seller.save()

      res.json({
        success: true,
        assignedProducts: seller.assignedProducts
      })

    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)
/* =====================================================
   CHECK EMAIL EXISTS
===================================================== */
app.get("/check-email", async (req, res) => {
  try {
    const email = req.query.email?.trim().toLowerCase()
    if (!email) return res.json({ exists: false })

    const user = await User.findOne({ email })
    res.json({ exists: !!user })

  } catch (err) {
    res.status(500).json({ exists: false })
  }
})

/* =====================================================
   SETTINGS — Email Domain Suffix
   GET  /settings/email-domain  → domain fetch karo
   POST /settings/email-domain  → admin domain set kare
===================================================== */

// GET — koi bhi logged user domain fetch kar sakta hai
app.get("/settings/email-domain", protect, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: "emailDomain" })
    res.json({ domain: setting?.value || "" })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST — sirf admin set kar sakta hai
app.post(
  "/settings/email-domain",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      let { domain } = req.body
      if (!domain) return res.status(400).json({ message: "Domain required" })

      // Clean: ensure starts with @
      domain = domain.trim()
      if (!domain.startsWith("@")) domain = "@" + domain

      await Settings.findOneAndUpdate(
        { key: "emailDomain" },
        { key: "emailDomain", value: domain },
        { upsert: true, new: true }
      )

      res.json({ success: true, domain })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

/* =====================================================
   ☢️ ADMIN DATA PURGE (NUKE) ROUTES
   GET  /admin/nuke/preview  — kitna data delete hoga
   POST /admin/nuke          — sab permanently delete
===================================================== */

app.get("/admin/nuke/preview", protect, allowRoles("admin"), async (req, res) => {
  try {
    const [
      userCount,
      orderCount,
      productCount,
      commissionCount,
      withdrawalCount,
      requestCount,
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: "admin" } }),
      Order.countDocuments({}),
      Product.countDocuments({}),
      Commission.countDocuments({}),
      mongoose.connection.db.collection("withdrawalrequests").countDocuments({}),
      UserRequest.countDocuments({}),
    ])
    res.json({
      users:       { count: userCount,       label: "Users (non-admin)" },
      orders:      { count: orderCount,      label: "Orders" },
      products:    { count: productCount,    label: "Products" },
      commissions: { count: commissionCount, label: "Commissions" },
      withdrawals: { count: withdrawalCount, label: "Withdrawal Requests" },
      requests:    { count: requestCount,    label: "User Requests" },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

app.post("/admin/nuke", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { confirmText, targets } = req.body

    if (confirmText !== "DELETE EVERYTHING") {
      return res.status(400).json({ message: "Confirmation text galat hai" })
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ message: "Koi target select nahi kiya" })
    }

    const results = {}

    if (targets.includes("users")) {
      const r = await User.deleteMany({ role: { $ne: "admin" } })
      results.users = r.deletedCount
    }
    if (targets.includes("orders")) {
      const r = await Order.deleteMany({})
      results.orders = r.deletedCount
    }
    if (targets.includes("products")) {
      const r = await Product.deleteMany({})
      results.products = r.deletedCount
    }
    if (targets.includes("commissions")) {
      const r = await Commission.deleteMany({})
      results.commissions = r.deletedCount

      // ✅ FIX: User ke wallet fields bhi reset karo — Commission delete se
      // yeh fields User document mein stored hain, Commission collection mein nahi
      await User.updateMany(
        { role: { $in: ["seller", "distributor"] } },
        {
          $set: {
            totalPPCEarned:       0,
            totalCoinEarned:      0,
            totalWithdrawn:       0,
            coinBalance:          0,
            walletBalance:        0,
            // Distributor wallets
            distributorWallet:    0,
            sellerWallet:         0,
            // Seller wallets
            sellerWalletAsSeller: 0,
            userWalletAsSeller:   0,
            totalPPCEarned:       0,
          }
        }
      )
      results.walletReset = "✅ Sab users ke wallet fields reset ho gaye"
    }
    if (targets.includes("withdrawals")) {
      const r = await mongoose.connection.db.collection("withdrawalrequests").deleteMany({})
      results.withdrawals = r.deletedCount
    }
    if (targets.includes("requests")) {
      const r = await UserRequest.deleteMany({})
      results.requests = r.deletedCount
    }

    // ✅ Notifications bhi clear karo (hamesha — stale data na rahe)
    try {
      const Notification = (await import("./models/Notification.js")).default
      await Notification.deleteMany({})
      results.notifications = "cleared"
    } catch (e) { /* ignore if model not yet created */ }

    console.log("☢️ ADMIN NUKE by:", req.user?.email, "| Deleted:", results)
    res.json({ success: true, deleted: results, message: "Sab kuch delete ho gaya" })

  } catch (err) {
    console.error("NUKE ERROR:", err)
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   🧾 INVOICE SETTINGS API
   GET  /api/invoice-settings  — sabko milega (for printing)
   POST /api/invoice-settings  — sirf admin set kar sakta hai
   GET  /api/invoice/:orderId  — order ka full data for invoice
===================================================== */

app.get("/api/invoice-settings", protect, async (req, res) => {
  try {
    const keys = ["invoiceCompanyName","invoiceTagline","invoiceAddress","invoicePhone",
                  "invoiceEmail","invoiceGST","invoiceFooter","invoiceLogo",
                  "invoiceThemeColor","invoiceShowLogo","invoiceTerms",
                  "invoiceShowBehalfInfo","invoiceCustomFields"]
    const docs = await Settings.find({ key: { $in: keys } })
    const result = {}
    docs.forEach(d => { result[d.key] = d.value })

    // Parse customFields JSON
    let customFields = []
    try { customFields = JSON.parse(result.invoiceCustomFields || "[]") } catch {}

    res.json({
      companyName:    result.invoiceCompanyName  || "Your Company",
      tagline:        result.invoiceTagline      || "",
      address:        result.invoiceAddress      || "",
      phone:          result.invoicePhone        || "",
      email:          result.invoiceEmail        || "",
      gst:            result.invoiceGST          || "",
      footer:         result.invoiceFooter       || "Thank you for your business!",
      logo:           result.invoiceLogo         || "",
      themeColor:     result.invoiceThemeColor   || "#1e293b",
      showLogo:       result.invoiceShowLogo     === "true",
      terms:          result.invoiceTerms        || "",
      showBehalfInfo: result.invoiceShowBehalfInfo !== "false", // default true
      customFields,   // [{label, value, position}]
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

app.post("/api/invoice-settings", protect, allowRoles("admin"), async (req, res) => {
  try {
    const map = {
      companyName:    "invoiceCompanyName",
      tagline:        "invoiceTagline",
      address:        "invoiceAddress",
      phone:          "invoicePhone",
      email:          "invoiceEmail",
      gst:            "invoiceGST",
      footer:         "invoiceFooter",
      logo:           "invoiceLogo",
      themeColor:     "invoiceThemeColor",
      showLogo:       "invoiceShowLogo",
      terms:          "invoiceTerms",
      showBehalfInfo: "invoiceShowBehalfInfo",
    }
    const ops = Object.entries(map).map(([k, dbKey]) => {
      if (req.body[k] === undefined) return null
      return Settings.findOneAndUpdate(
        { key: dbKey },
        { key: dbKey, value: String(req.body[k]) },
        { upsert: true, new: true }
      )
    }).filter(Boolean)

    // Custom fields — JSON array save karo
    if (req.body.customFields !== undefined) {
      ops.push(Settings.findOneAndUpdate(
        { key: "invoiceCustomFields" },
        { key: "invoiceCustomFields", value: JSON.stringify(req.body.customFields) },
        { upsert: true, new: true }
      ))
    }

    await Promise.all(ops)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

app.get("/api/invoice/:orderId", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("sellerId",      "name email role")
      .populate("userId",        "name email role")
      .populate("distributorId", "name email")
      .lean()
    if (!order) return res.status(404).json({ message: "Order not found" })
    res.json(order)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* =====================================================
   HEALTH CHECK
===================================================== */
app.get("/health", (req, res) => {
  res.json({ status: "OK", time: new Date() })
})

/* =====================================================
   SERVER START
===================================================== */
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`)
})

 

