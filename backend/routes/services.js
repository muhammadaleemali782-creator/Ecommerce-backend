import express from "express"
import multer from "multer"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import Service from "../models/Service.js"

const router = express.Router()

/* ── Optional auth: token ho to user set karo, na ho to bhi allow karo ── */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null
    return next()
  }
  // token hai — protect middleware ki tarah verify karo
  protect(req, res, (err) => {
    if (err) {
      req.user = null
      return next()
    }
    next()
  })
}

/* ⭐ Image upload config (optional thumbnail for a service card) */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
})
const upload = multer({ storage })

/* =====================================================
   PUBLIC — sab logged-in users ko sirf ACTIVE services dikhengi
===================================================== */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const services = await Service.find({ isActive: true }).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, services })
  } catch (err) {
    console.error("❌ GET /services error:", err.message)
    res.status(500).json({ success: false, message: "Services load nahi ho payi" })
  }
})

/* =====================================================
   ADMIN — saari services (active + inactive) — manage karne ke liye
===================================================== */
router.get("/admin/all", protect, allowRoles("admin"), async (req, res) => {
  try {
    const services = await Service.find().sort({ order: 1, createdAt: -1 })
    res.json({ success: true, services })
  } catch (err) {
    console.error("❌ GET /services/admin/all error:", err.message)
    res.status(500).json({ success: false, message: "Services load nahi ho payi" })
  }
})

/* =====================================================
   ADMIN — naya service add karo
===================================================== */
router.post("/", protect, allowRoles("admin"), upload.single("image"), async (req, res) => {
  try {
    const { title, description, link, linkType, type, order, category } = req.body

    if (!title || !link) {
      return res.status(400).json({ success: false, message: "Title aur Link dono required hain" })
    }

    const service = await Service.create({
      title,
      description: description || "",
      link,
      linkType: linkType === "internal" ? "internal" : "external",
      type: ["square", "video", "banner", "round", "list"].includes(type) ? type : "square",
      category: category?.trim() || "General",
      order: Number(order) || 0,
      image: req.file ? `/uploads/${req.file.filename}` : "",
      createdBy: req.user.id
    })

    res.json({ success: true, service })
  } catch (err) {
    console.error("❌ POST /services error:", err.message)
    res.status(500).json({ success: false, message: "Service add nahi ho payi" })
  }
})

/* =====================================================
   ADMIN — service edit karo
===================================================== */
router.put("/:id", protect, allowRoles("admin"), upload.single("image"), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
    if (!service) return res.status(404).json({ success: false, message: "Service nahi mili" })

    const { title, description, link, linkType, type, order, isActive, category } = req.body

    if (title !== undefined) service.title = title
    if (description !== undefined) service.description = description
    if (link !== undefined) service.link = link
    if (linkType !== undefined) service.linkType = linkType === "internal" ? "internal" : "external"
    if (type !== undefined) service.type = ["square", "video", "banner", "round", "list"].includes(type) ? type : "square"
    if (category !== undefined) service.category = category.trim() || "General"
    if (order !== undefined) service.order = Number(order) || 0
    if (isActive !== undefined) service.isActive = isActive === "true" || isActive === true
    if (req.file) service.image = `/uploads/${req.file.filename}`

    await service.save()
    res.json({ success: true, service })
  } catch (err) {
    console.error("❌ PUT /services/:id error:", err.message)
    res.status(500).json({ success: false, message: "Service update nahi ho payi" })
  }
})

/* =====================================================
   ADMIN — service delete karo
===================================================== */
router.delete("/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id)
    if (!service) return res.status(404).json({ success: false, message: "Service nahi mili" })
    res.json({ success: true, message: "Service delete ho gayi" })
  } catch (err) {
    console.error("❌ DELETE /services/:id error:", err.message)
    res.status(500).json({ success: false, message: "Service delete nahi ho payi" })
  }
})

export default router
