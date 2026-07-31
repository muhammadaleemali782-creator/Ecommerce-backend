import express from "express"
import multer from "multer"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import HomeBanner from "../models/HomeBanner.js"

const router = express.Router()

/* =====================================================
   UPLOAD CONFIG — image / gif / video sab accept karega
   Ab DO files ek saath: "media" (desktop/default) + "mediaMobile" (optional)
   Video ke liye size limit thoda bada rakha hai (80MB per file)
===================================================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
})

const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB per file — video ke liye kaafi
  fileFilter: (req, file, cb) => {
    const ok = /^image\/|^video\//.test(file.mimetype)
    if (!ok) return cb(new Error("Sirf image, gif ya video upload kar sakte ho"))
    cb(null, true)
  },
})

// Do alag files ek saath — desktop/default "media" + optional "mediaMobile"
const uploadBannerFiles = upload.fields([
  { name: "media", maxCount: 1 },
  { name: "mediaMobile", maxCount: 1 },
])

// Mimetype se mediaType decide karo
const detectMediaType = (file) => {
  if (!file) return "image"
  if (file.mimetype.startsWith("video/")) return "video"
  if (file.mimetype === "image/gif") return "gif"
  return "image"
}

const VALID_PLACEMENTS = ["hero", "slot1", "slot2", "slot3"]
const normalizePlacement = (p) => (VALID_PLACEMENTS.includes(p) ? p : "hero")

/* =====================================================
   PUBLIC — Home page ke liye ACTIVE banners, order se sorted
   ?placement=hero | slot1 | slot2 | slot3 se filter kar sakte ho
===================================================== */
router.get("/", async (req, res) => {
  try {
    const filter = { isActive: true }
    if (req.query.placement) filter.placement = normalizePlacement(req.query.placement)

    const banners = await HomeBanner.find(filter).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, banners })
  } catch (err) {
    console.error("❌ GET /banners error:", err.message)
    res.status(500).json({ success: false, message: "Banners load nahi ho paye" })
  }
})

/* =====================================================
   ADMIN — saare banners (active + inactive) — manage panel ke liye
===================================================== */
router.get("/admin/all", protect, allowRoles("admin"), async (req, res) => {
  try {
    const banners = await HomeBanner.find().sort({ placement: 1, order: 1, createdAt: -1 })
    res.json({ success: true, banners })
  } catch (err) {
    console.error("❌ GET /banners/admin/all error:", err.message)
    res.status(500).json({ success: false, message: "Banners load nahi ho paye" })
  }
})

/* =====================================================
   ADMIN — naya banner add karo (image/gif/video, mobile ke liye alag optional)
===================================================== */
router.post("/", protect, allowRoles("admin"), uploadBannerFiles, async (req, res) => {
  try {
    const desktopFile = req.files?.media?.[0]
    const mobileFile  = req.files?.mediaMobile?.[0]

    if (!desktopFile) {
      return res.status(400).json({ success: false, message: "Media file (image/gif/video) required hai" })
    }

    const { title, subtitle, eyebrow, align, buttonText, buttonLink, linkType, overlay, order, placement } = req.body

    const banner = await HomeBanner.create({
      title: title || "",
      subtitle: subtitle || "",
      eyebrow: eyebrow || "",
      align: align === "center" ? "center" : "left",
      buttonText: buttonText || "",
      buttonLink: buttonLink || "",
      linkType: linkType === "external" ? "external" : "internal",
      mediaType: detectMediaType(desktopFile),
      media: `/uploads/${desktopFile.filename}`,
      mediaTypeMobile: mobileFile ? detectMediaType(mobileFile) : "",
      mediaMobile: mobileFile ? `/uploads/${mobileFile.filename}` : "",
      placement: normalizePlacement(placement),
      overlay: overlay === "false" ? false : true,
      order: Number(order) || 0,
      createdBy: req.user.id,
    })

    res.json({ success: true, banner })
  } catch (err) {
    console.error("❌ POST /banners error:", err.message)
    res.status(500).json({ success: false, message: "Banner add nahi ho paya" })
  }
})

/* =====================================================
   ADMIN — banner edit karo (naya media optional, desktop/mobile alag-alag)
===================================================== */
router.put("/:id", protect, allowRoles("admin"), uploadBannerFiles, async (req, res) => {
  try {
    const banner = await HomeBanner.findById(req.params.id)
    if (!banner) return res.status(404).json({ success: false, message: "Banner nahi mila" })

    const { title, subtitle, eyebrow, align, buttonText, buttonLink, linkType, overlay, order, isActive, placement, clearMobile } = req.body

    if (title !== undefined) banner.title = title
    if (subtitle !== undefined) banner.subtitle = subtitle
    if (eyebrow !== undefined) banner.eyebrow = eyebrow
    if (align !== undefined) banner.align = align === "center" ? "center" : "left"
    if (buttonText !== undefined) banner.buttonText = buttonText
    if (buttonLink !== undefined) banner.buttonLink = buttonLink
    if (linkType !== undefined) banner.linkType = linkType === "external" ? "external" : "internal"
    if (overlay !== undefined) banner.overlay = overlay === "true" || overlay === true
    if (order !== undefined) banner.order = Number(order) || 0
    if (isActive !== undefined) banner.isActive = isActive === "true" || isActive === true
    if (placement !== undefined) banner.placement = normalizePlacement(placement)

    const desktopFile = req.files?.media?.[0]
    const mobileFile  = req.files?.mediaMobile?.[0]

    if (desktopFile) {
      banner.media = `/uploads/${desktopFile.filename}`
      banner.mediaType = detectMediaType(desktopFile)
    }
    if (mobileFile) {
      banner.mediaMobile = `/uploads/${mobileFile.filename}`
      banner.mediaTypeMobile = detectMediaType(mobileFile)
    } else if (clearMobile === "true") {
      // Admin ne mobile-specific media hata di — ab wapas desktop wala hi mobile pe bhi chalega
      banner.mediaMobile = ""
      banner.mediaTypeMobile = ""
    }

    await banner.save()
    res.json({ success: true, banner })
  } catch (err) {
    console.error("❌ PUT /banners/:id error:", err.message)
    res.status(500).json({ success: false, message: "Banner update nahi ho paya" })
  }
})

/* =====================================================
   ADMIN — banner delete karo
===================================================== */
router.delete("/:id", protect, allowRoles("admin"), async (req, res) => {
  try {
    const banner = await HomeBanner.findByIdAndDelete(req.params.id)
    if (!banner) return res.status(404).json({ success: false, message: "Banner nahi mila" })
    res.json({ success: true, message: "Banner delete ho gaya" })
  } catch (err) {
    console.error("❌ DELETE /banners/:id error:", err.message)
    res.status(500).json({ success: false, message: "Banner delete nahi ho paya" })
  }
})

/* =====================================================
   MULTER ERROR HANDLER (file size / type errors readable banao)
===================================================== */
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes("image, gif ya video")) {
    return res.status(400).json({ success: false, message: err.message })
  }
  next(err)
})

export default router
