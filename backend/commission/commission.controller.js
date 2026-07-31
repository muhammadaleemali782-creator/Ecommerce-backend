import mongoose from "mongoose"
import Commission from "./commission.model.js"
import User from "../models/User.js"
import CommissionLevel from "./commissionLevels.model.js"   // ⭐ NEW ADD (level system support)

/* =====================================================
   CREATE COMMISSION (AUTO CALL ON ORDER CONFIRM)
===================================================== */
export const createCommissionFromOrder = async (order) => {
  try {

    console.log("🧪 DEBUG START createCommissionFromOrder");
    console.log("ORDER =", order);
    console.log("ORDER TOTAL =", order?.total);
    console.log("SELLER ID =", order?.sellerId);

    /* ⭐ EXTRA SAFE CHECKS ADDED */
    if (!order) {
      console.log("⚠️ Commission skipped: Order missing")
      return
    }

    if (!order.total || !order._id) {
      console.log("⚠️ Commission skipped: Invalid order")
      return
    }

    if (!mongoose.Types.ObjectId.isValid(order._id)) {
      console.log("⚠️ Commission skipped: Invalid orderId format")
      return
    }

    console.log("💰 Creating commission for order:", order._id)

    /* ✅ Seller find */
    const seller = await User.findById(order.sellerId)
    console.log("SELLER FOUND =", seller);

    if (!seller) {
      console.log("⚠️ Seller not found for order")
      return
    }

    if (!mongoose.Types.ObjectId.isValid(seller._id)) {
      console.log("⚠️ Invalid seller id")
      return
    }

    /* ===== Prevent Duplicate Commission ===== */
    const already = await Commission.findOne({
      orderId: order._id,
      toUser: seller._id
    })

    if (already) {
      console.log("⚠️ Commission already created for this order")
      return
    }

    const total = Number(order.total) || 0
    console.log("TOTAL NUMBER =", total);

    if (total <= 0) {
      console.log("⚠️ Commission skipped: total <= 0")
      return
    }

    /* ⭐ Load LEVEL CONFIG */
    let levels = []
    try {
      levels = await CommissionLevel.find().sort({ level: 1 })
      console.log("LEVELS FROM DB =", levels);
    } catch (e) {
      console.log("⚠️ Level config not found → using default %")
    }

    /* =====================================================
       ⭐ MLM LEVEL LOOP
       Level-1 = Seller
       Level-2 = Parent
       Level-3 = Parent Parent
       Level-4+ = Only coin
    ===================================================== */

    let currentUser = seller
    let levelNumber = 1

    while (currentUser) {

      console.log("➡️ Processing level:", levelNumber, "User:", currentUser._id)

      if (currentUser.role === "admin") {
        console.log("⚠️ Admin skipped")
      } else {

        const levelData = levels.find(
          l => Number(l.level) === Number(levelNumber)
        )

        let percent = levelData?.percent ?? 0
        let amount = total * (percent / 100)

        if (levelNumber <= 3) {

          const exists = await Commission.findOne({
            orderId: order._id,
            toUser: currentUser._id
          })

          if (!exists && amount > 0) {
            await Commission.create({
              fromUser: order.sellerId,
              toUser: currentUser._id,
              orderId: order._id,
              amount,
              percent,
              level: levelNumber,
              status: "approved"
            })

            console.log("✅ Real commission saved for level", levelNumber)
          }

        } else {

          /* ⭐ ONLY COIN FOR LEVEL 4+ */
          currentUser.coinBalance =
            (Number(currentUser.coinBalance) || 0) + percent

          await currentUser.save()

          console.log("🪙 Coin added for upper level:", currentUser._id)
        }
      }

      if (!currentUser.parentId) break
      currentUser = await User.findById(currentUser.parentId)
      levelNumber++
    }

    console.log("🎉 Commission created successfully")

  } catch (err) {
    console.error("❌ Commission error:", err.message)
    console.error(err)
  }
}


/* =====================================================
   USER → MY COMMISSIONS
===================================================== */
export const getMyCommissions = async (req, res) => {
  try {

    console.log("🧪 DEBUG getMyCommissions USER =", req.user);

    if (!req.user?.id) {
      console.log("⚠️ Unauthorized commission fetch attempt")
      return res.status(401).json({ message: "Unauthorized" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      console.log("⚠️ Invalid user id in getMyCommissions")
      return res.status(400).json({ message: "Invalid user id" })
    }

    console.log("📥 Loading commissions for user:", req.user.id)

    const list = await Commission.find({
      toUser: req.user.id
    })
      .populate("orderId")
      .populate("fromUser", "name email role")
      .populate("toUser", "name email role")
      .sort({ createdAt: -1 })

    console.log("📊 Commission count:", list.length)

    res.json(list)

  } catch (err) {
    console.error("❌ getMyCommissions:", err.message)
    console.error(err)
    res.status(500).json({ message: err.message })
  }
}


/* =====================================================
   ADMIN → ALL COMMISSIONS
===================================================== */
export const getAllCommissions = async (req, res) => {
  try {

    console.log("🧪 DEBUG getAllCommissions USER =", req.user);

    console.log("📥 Admin fetching all commissions")

    const list = await Commission.find()
      .populate("fromUser", "name email role")
      .populate("toUser", "name email role")
      .populate("orderId")
      .sort({ createdAt: -1 })

    console.log("📊 Total commissions:", list.length)

    res.json(list)

  } catch (err) {
    console.error("❌ getAllCommissions:", err.message)
    console.error(err)
    res.status(500).json({ message: err.message })
  }
} 