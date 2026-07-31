import CommissionLevel from "./commissionLevels.model.js"

/* ===============================
   ADMIN → SET LEVELS
=============================== */
export const saveLevels = async (req, res) => {
  try {

    /* ⭐ EXTRA SAFETY CHECKS ADDED */
    if (!req.body) {
      console.log("⚠️ saveLevels: Body missing")
      return res.status(400).json({ message: "Request body missing" })
    }

    if (!Array.isArray(req.body.levels)) {
      console.log("⚠️ saveLevels: levels array missing")
      return res.status(400).json({ message: "Levels must be array" })
    }

    if (req.body.levels.length === 0) {
      console.log("⚠️ saveLevels: Empty levels array")
      return res.status(400).json({ message: "Levels array empty" })
    }

    /* ⭐ VALIDATE EACH LEVEL */
    for (const lvl of req.body.levels) {

      if (lvl.level === undefined || lvl.percent === undefined || !lvl.role) {
        console.log("⚠️ Invalid level entry:", lvl)
        return res.status(400).json({
          message: "Each level must have level, percent, role"
        })
      }

      if (Number(lvl.percent) < 0) {
        console.log("⚠️ Negative percent not allowed:", lvl)
        return res.status(400).json({
          message: "Percent must be >= 0"
        })
      }

      if (Number(lvl.percent) > 100) {
        console.log("⚠️ Percent > 100 not allowed:", lvl)
        return res.status(400).json({
          message: "Percent must be <= 100"
        })
      }
    }

    console.log("📥 Saving commission levels:", req.body.levels)

    /* ⭐ DELETE OLD LEVELS */
    await CommissionLevel.deleteMany()

    /* ⭐ INSERT NEW LEVELS */
    const saved = await CommissionLevel.insertMany(req.body.levels)

    console.log("✅ Levels saved:", saved.length)

    res.json({
      success: true,
      count: saved.length,
      levels: saved
    })

  } catch (err) {
    console.error("❌ saveLevels error:", err.message)
    res.status(500).json({ message: err.message })
  }
}


/* ===============================
   ADMIN → GET LEVELS
=============================== */
export const getLevels = async (req, res) => {
  try {

    console.log("📥 Loading commission levels")

    const levels = await CommissionLevel
      .find()
      .sort({ level: 1 })

    console.log("📊 Levels count:", levels.length)

    if (!levels || levels.length === 0) {
      console.log("⚠️ No commission levels found")
      return res.json([])
    }

    res.json(levels)

  } catch (err) {
    console.error("❌ getLevels error:", err.message)
    res.status(500).json({ message: err.message })
  }
}


/* =====================================================
   ⭐ EXTRA EXPORTS (FOR ROUTES FILE COMPATIBILITY)
===================================================== */
export const saveCommissionLevels = saveLevels
export const getCommissionLevels = getLevels