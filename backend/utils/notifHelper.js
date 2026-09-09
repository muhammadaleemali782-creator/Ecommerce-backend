import Notification from "../models/Notification.js"
import User from "../models/User.js"
import { getFirebaseAdmin } from "./firebaseAdmin.js"

/* ─────────────────────────────────────────────────────────
   sendPush — FCM ke through phone pe asli push notification
   bhejo (app band ho tab bhi kaam karta hai)
───────────────────────────────────────────────────────── */
async function sendPush(userId, title, body) {
  try {
    const fb = getFirebaseAdmin()
    if (!fb) return   // Firebase configure nahi hai — chup-chaap skip

    const user = await User.findById(userId).select("fcmToken")
    if (!user?.fcmToken) return

    await fb.messaging().send({
      token: user.fcmToken,
      notification: { title: title || "EDUCA Store", body },
      android: {
        priority: "high",
        notification: { sound: "notification_bird", channelId: "educa_store_alerts" },
      },
    })
  } catch (err) {
    console.error("❌ Push send error:", err.message)
  }
}

/* ─────────────────────────────────────────────────────────
   createNotif — ek notification banao
   userId     : recipient ka _id
   type       : "new_order" | "dist_approved" | "confirmed" | "rejected" | "general"
   message    : notification text
   opts       : { senderName, senderRole, orderId, targetPage }
───────────────────────────────────────────────────────── */
export async function createNotif(userId, type, message, opts = {}) {
  try {
    if (!userId) return // 🛡️ Recipient ID hona laazmi hai

    await Notification.create({
      userId,
      type,
      message,
      senderName: opts.senderName || "",
      senderRole: opts.senderRole || "",
      orderId:    opts.orderId    || null,
      targetPage: opts.targetPage || "",
      read:       false,
    })

    // 📱 Har notification ke saath asli phone push bhi bhejo
    sendPush(userId, opts.senderName || "EDUCA Store", message)
  } catch (err) {
    console.error("❌ Notification create error:", err.message)
  }
}

/* ─────────────────────────────────────────────────────────
   notifyNewOrder — Naya order create hua
   Notify: buyer (confirmation), assigned distributor, admins
───────────────────────────────────────────────────────── */
export async function notifyNewOrder({ order, seller, distributor, adminIds = [] }) {
  const ordShort = String(order._id).slice(-6)
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`
  const name     = seller?.name || "Someone"
  const role     = seller?.role || "seller"
  const buyerId  = String(seller?._id || order.placedById || order.userId || "")

  // 1. Buyer ko confirmation notification bhejo
  if (buyerId) {
    await createNotif(buyerId, "new_order",
      `🛒 Aapki order #${ordShort} successfully place ho gayi hai (${amt})`, {
        senderName: "EDUCA Store",
        senderRole: "system",
        orderId:    order._id,
        targetPage: role === "distributor" ? "distributor-orders" : role === "seller" ? "seller-orders" : "orders",
      })
  }

  // 2. Assigned Distributor ko batao (sirf agar distributor buyer se alag ho)
  if (distributor && String(distributor._id) !== buyerId) {
    await createNotif(distributor._id, "new_order",
      `🛒 ${name} (${role}) ne nayi order #${ordShort} di — ${amt}`, {
        senderName: name,
        senderRole: role,
        orderId:    order._id,
        targetPage: "distributor-orders",
      })
  }

  // 3. Admins ko batao (lekin agar buyer khud admin hai to use alert mat bhejo)
  for (const adminId of adminIds) {
    if (String(adminId) !== buyerId) {
      await createNotif(adminId, "new_order",
        `🛒 ${name} (${role}) ne nayi order #${ordShort} di — ${amt}`, {
          senderName: name,
          senderRole: role,
          orderId:    order._id,
          targetPage: "admin-orders",
        })
    }
  }
}

/* ─────────────────────────────────────────────────────────
   notifyDistApproved — Distributor ne approve kiya
   Notify: buyer/seller + admins
───────────────────────────────────────────────────────── */
export async function notifyDistApproved({ order, distributor, adminIds = [] }) {
  const ordShort = String(order._id).slice(-6)
  const distName = distributor?.name || "Distributor"
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`
  const distId   = String(distributor?._id || "")

  // 1. Customer/User ko batao (agar user alag hai)
  if (order.userId && String(order.userId) !== distId) {
    await createNotif(order.userId, "dist_approved",
      `✅ Aapki order #${ordShort} distributor (${distName}) ne approve kar di (${amt})`, {
        senderName: distName,
        senderRole: "distributor",
        orderId:    order._id,
        targetPage: "orders",
      })
  }

  // 2. Seller ko batao (sirf agar seller distributor se alag hai aur user se bhi alag hai)
  if (order.sellerId && String(order.sellerId) !== distId && String(order.sellerId) !== String(order.userId)) {
    await createNotif(order.sellerId, "dist_approved",
      `✅ ${distName} ne aapki order #${ordShort} approve kar di (${amt})`, {
        senderName: distName,
        senderRole: "distributor",
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }

  // 3. Admin ko alert bhejo (sirf un admins ko jo is action ke distributor nahi hain)
  for (const adminId of adminIds) {
    if (String(adminId) !== distId) {
      await createNotif(adminId, "dist_approved",
        `🔵 ${distName} ne order #${ordShort} approve kiya — Admin approval baaki (${amt})`, {
          senderName: distName,
          senderRole: "distributor",
          orderId:    order._id,
          targetPage: "admin-orders",
        })
    }
  }
}

/* ─────────────────────────────────────────────────────────
   notifyConfirmed — Admin ne final confirm kiya
   Notify: buyer (user/seller) + distributor
───────────────────────────────────────────────────────── */
export async function notifyConfirmed({ order }) {
  const ordShort = String(order._id).slice(-6)
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`

  // 1. Actual Customer/User ko confirm karo
  if (order.userId) {
    await createNotif(order.userId, "confirmed",
      `🎉 Aapki order #${ordShort} confirm ho gayi hai! (${amt})`, {
        senderName: "Admin",
        senderRole: "admin",
        orderId:    order._id,
        targetPage: "orders",
      })
  }

  // 2. Seller ko batao (sirf agar seller userId se alag ho)
  if (order.sellerId && String(order.sellerId) !== String(order.userId)) {
    await createNotif(order.sellerId, "confirmed",
      `🎉 Order #${ordShort} confirm ho gayi! PPC + Commission credit ho gayi (${amt})`, {
        senderName: "Admin",
        senderRole: "admin",
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }

  // 3. Distributor ko batao (sirf agar distributor sellerId aur userId se alag ho)
  if (order.distributorId &&
      String(order.distributorId) !== String(order.sellerId) &&
      String(order.distributorId) !== String(order.userId)) {
    await createNotif(order.distributorId, "confirmed",
      `🎉 Order #${ordShort} Admin ne confirm kar di! (${amt})`, {
        senderName: "Admin",
        senderRole: "admin",
        orderId:    order._id,
        targetPage: "distributor-orders",
      })
  }
}

/* ─────────────────────────────────────────────────────────
   notifyRejected — Order reject hui
   Notify: buyer / seller
───────────────────────────────────────────────────────── */
export async function notifyRejected({ order, rejectorName, rejectorRole }) {
  const ordShort = String(order._id).slice(-6)
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`
  const name     = rejectorName || "Admin"

  // 1. User/Customer ko batao
  if (order.userId) {
    await createNotif(order.userId, "rejected",
      `❌ Aapki order #${ordShort} reject kar di gayi (${amt})`, {
        senderName: name,
        senderRole: rejectorRole,
        orderId:    order._id,
        targetPage: "orders",
      })
  }

  // 2. Seller ko batao (agar seller userId se alag ho)
  if (order.sellerId && String(order.sellerId) !== String(order.userId)) {
    await createNotif(order.sellerId, "rejected",
      `❌ ${name} (${rejectorRole}) ne order #${ordShort} reject kar di (${amt})`, {
        senderName: name,
        senderRole: rejectorRole,
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }
}

/* ─────────────────────────────────────────
   notifyNewUserRequest
   Naya user-request banaya gaya (raise-request)
   Notify: admins (except requester)
───────────────────────────────────────── */
export async function notifyNewUserRequest({ request, requesterName, requesterRole, requesterId, adminIds = [] }) {
  const forText = request.requestedForId ? "kisi member ke liye" : "apne liye"
  const msg = `📝 ${requesterName} (${requesterRole}) ne ${forText} naya "${request.type}" account request kiya hai — ${request.name}`

  for (const adminId of adminIds) {
    if (String(adminId) !== String(requesterId)) {
      await createNotif(adminId, "general", msg, {
        senderName: requesterName,
        senderRole: requesterRole,
        targetPage: "admin-requests",
      })
    }
  }
}

/* ─────────────────────────────────────────
   notifyRequestApproved
   Admin ne request approve ki
   Notify: requester + requestedFor (excluding admin who approved)
───────────────────────────────────────── */
export async function notifyRequestApproved({ request, requesterId, requestedForId, newUserName, tempPassword, newUserFullName, adminId }) {
  const targetName = newUserFullName || request.name || "User"
  const passInfo   = tempPassword ? ` | Password: ${tempPassword}` : ""
  const msg        = `✅ ${targetName} ka "${request.type}" account create ho gaya hai! User ID: ${newUserName}${passInfo}. Kripya user ko details bhej dijiye.`

  // 1. Requester ko batao (agar requester admin khud nahi hai)
  if (requesterId && String(requesterId) !== String(adminId)) {
    await createNotif(requesterId, "general", msg, {
      senderName: "Admin",
      senderRole: "admin",
      targetPage: "my-network",
    })
  }

  // 2. Agar requestedFor requester aur admin dono se alag hai, use bhi batao
  if (requestedForId &&
      String(requestedForId) !== String(requesterId) &&
      String(requestedForId) !== String(adminId)) {
    await createNotif(requestedForId, "general",
      `✅ Aapke referral se ${targetName} ka "${request.type}" account create ho gaya hai! User ID: ${newUserName}${passInfo}. Kripya user ko details bhej dijiye.`, {
        senderName: "Admin",
        senderRole: "admin",
        targetPage: "my-network",
      })
  }
}

/* ─────────────────────────────────────────
   notifyRequestRejected
   Admin ne request reject ki
   Notify: requester + requestedFor (excluding admin)
───────────────────────────────────────── */
export async function notifyRequestRejected({ request, requesterId, requestedForId, adminId }) {
  const msg = `❌ Aapki "${request.type}" account request reject ho gayi (${request.name})`

  if (requesterId && String(requesterId) !== String(adminId)) {
    await createNotif(requesterId, "general", msg, {
      senderName: "Admin",
      senderRole: "admin",
      targetPage: "raise-request",
    })
  }

  if (requestedForId &&
      String(requestedForId) !== String(requesterId) &&
      String(requestedForId) !== String(adminId)) {
    await createNotif(requestedForId, "general",
      `❌ Aapke liye request kiya gaya "${request.type}" account reject ho gaya (${request.name})`, {
        senderName: "Admin",
        senderRole: "admin",
        targetPage: "raise-request",
      })
  }
}

/* ─────────────────────────────────────────
   notifyLevelUp
   Seller/Distributor ne naya PPC level complete kiya
   Notify: sirf wahi user (jisne complete kiya)
───────────────────────────────────────── */
export async function notifyLevelUp({ userId, role, levelName, reward }) {
  const rewardText = reward ? ` 🎁 Reward: ${reward}` : ""
  const msg = `🎉 Congratulations! Aapne "${levelName}" level complete kar liya!${rewardText}`

  await createNotif(userId, "general", msg, {
    senderName: "PPC System",
    senderRole: "system",
    targetPage: "ppc-wallet",
  })
}

/* ─────────────────────────────────────────
   notifyRewardClaimRequested
   User ne reward claim kiya — admins ko batao
───────────────────────────────────────── */
export async function notifyRewardClaimRequested({ user, levelName, rewardText, adminIds = [] }) {
  const msg = `🏆 ${user?.name || "User"} (${user?.role || ""}) ne "${levelName}" reward claim kiya hai — ₹ payment pending. Reward: ${rewardText}`

  for (const adminId of adminIds) {
    await createNotif(adminId, "general", msg, {
      senderName: user?.name || "User",
      senderRole: user?.role || "",
      targetPage: "admin-reward-claims",
    })
  }
}

/* ─────────────────────────────────────────
   notifyRewardPaid
   Admin ne reward payment kar di — user ko batao
───────────────────────────────────────── */
export async function notifyRewardPaid({ userId, levelName, rewardText }) {
  const msg = `✅ Aapki "${levelName}" reward (${rewardText}) admin ne pay kar di hai!`

  await createNotif(userId, "general", msg, {
    senderName: "Admin",
    senderRole: "admin",
    targetPage: "ppc-wallet",
  })
}

/* ─────────────────────────────────────────
   notifyRewardRejected
   Admin ne reward claim reject ki — user ko batao
───────────────────────────────────────── */
export async function notifyRewardRejected({ userId, levelName, note }) {
  const noteText = note ? ` Reason: ${note}` : ""
  const msg = `❌ Aapki "${levelName}" reward claim reject ho gayi.${noteText}`

  await createNotif(userId, "general", msg, {
    senderName: "Admin",
    senderRole: "admin",
    targetPage: "ppc-wallet",
  })
}
