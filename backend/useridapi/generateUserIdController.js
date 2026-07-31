import User from "../models/User.js"
import { generateUserId } from "../utils/generateUserId.js"

export const getNextUserId = async (req, res) => {
  try {

    const { type, parentId } = req.query

    if (!type) {
      return res.status(400).json({ message: "type required" })
    }

    /* ── Get parent name if parentId provided ── */
    let parentName = null
    if (parentId) {
      const parent = await User.findById(parentId).select("name").lean()
      if (parent) parentName = parent.name
    }

    const id = await generateUserId(type, User, parentName)

    res.json({ id })

  } catch (err) {
    console.error("ID generation error", err)
    res.status(500).json({ message: "Server error" })
  }
}
