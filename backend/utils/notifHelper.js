import Notification from "../models/Notification.js"

/* ─────────────────────────────────────────────────────────
   createNotif — ek notification banao
   userId     : recipient ka _id
   type       : "new_order" | "dist_approved" | "confirmed" | "rejected" | "general"
   message    : notification text
   opts       : { senderName, senderRole, orderId, targetPage }
───────────────────────────────────────────────────────── */
export async function createNotif(userId, type, message, opts = {}) {
  try {
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
  } catch (err) {
    console.error("❌ Notification create error:", err.message)
  }
}

/* ─────────────────────────────────────────────────────────
   notifyNewOrder — Naya order create hua
   Notify: distributor + admin
───────────────────────────────────────────────────────── */
export async function notifyNewOrder({ order, seller, distributor, adminIds = [] }) {
  const amt  = `₹${Number(order.total || 0).toLocaleString("en-IN")}`
  const name = seller?.name || "Someone"
  const role = seller?.role || "seller"

  const msg = `🛒 ${name} (${role}) ne nayi order di — ${amt}`

  // Distributor ko batao
  if (distributor) {
    await createNotif(distributor._id, "new_order", msg, {
      senderName: name,
      senderRole: role,
      orderId:    order._id,
      targetPage: "distributor-orders",
    })
  }

  // Sab admins ko batao
  for (const adminId of adminIds) {
    await createNotif(adminId, "new_order", msg, {
      senderName: name,
      senderRole: role,
      orderId:    order._id,
      targetPage: "admin-orders",
    })
  }
}

/* ─────────────────────────────────────────────────────────
   notifyDistApproved — Distributor ne approve kiya
   Notify: seller + admin
───────────────────────────────────────────────────────── */
export async function notifyDistApproved({ order, distributor, adminIds = [] }) {
  const ordShort = String(order._id).slice(-6)
  const distName = distributor?.name || "Distributor"
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`

  // Seller ko batao
  if (order.sellerId) {
    await createNotif(order.sellerId, "dist_approved",
      `✅ ${distName} ne aapki order #${ordShort} approve kar di (${amt})`, {
        senderName: distName,
        senderRole: "distributor",
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }

  // Admin ko batao
  for (const adminId of adminIds) {
    await createNotif(adminId, "dist_approved",
      `🔵 ${distName} ne order #${ordShort} approve kiya — Admin approval baaki (${amt})`, {
        senderName: distName,
        senderRole: "distributor",
        orderId:    order._id,
        targetPage: "admin-orders",
      })
  }
}

/* ─────────────────────────────────────────────────────────
   notifyConfirmed — Admin ne final confirm kiya
   Notify: seller + distributor
───────────────────────────────────────────────────────── */
export async function notifyConfirmed({ order }) {
  const ordShort = String(order._id).slice(-6)
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`

  // Seller ko batao
  if (order.sellerId) {
    await createNotif(order.sellerId, "confirmed",
      `🎉 Aapki order #${ordShort} confirm ho gayi! PPC + Commission mil gayi (${amt})`, {
        senderName: "Admin",
        senderRole: "admin",
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }

  // Distributor ko batao
  if (order.distributorId) {
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
   Notify: seller
───────────────────────────────────────────────────────── */
export async function notifyRejected({ order, rejectorName, rejectorRole }) {
  const ordShort = String(order._id).slice(-6)
  const amt      = `₹${Number(order.total || 0).toLocaleString("en-IN")}`
  const name     = rejectorName || "Admin/Distributor"

  if (order.sellerId) {
    await createNotif(order.sellerId, "rejected",
      `❌ ${name} (${rejectorRole}) ne order #${ordShort} reject kar di (${amt})`, {
        senderName: name,
        senderRole: rejectorRole,
        orderId:    order._id,
        targetPage: "seller-orders",
      })
  }

  // Agar distributor ne reject kiya, admin ko bhi batao
  if (rejectorRole === "distributor" && order.distributorId) {
    // No need to notify distributor themselves
  }
}

/* ─────────────────────────────────────────
   notifyNewUserRequest
   Naya user-request banaya gaya (raise-request)
   Notify: admins
───────────────────────────────────────── */
export async function notifyNewUserRequest({ request, requesterName, requesterRole, adminIds = [] }) {
  const forText = request.requestedForId ? "kisi member ke liye" : "apne liye"
  const msg = `📝 ${requesterName} (${requesterRole}) ne ${forText} naya "${request.type}" account request kiya hai — ${request.name}`

  for (const adminId of adminIds) {
    await createNotif(adminId, "general", msg, {
      senderName: requesterName,
      senderRole: requesterRole,
      targetPage: "admin-requests",
    })
  }
}

/* ─────────────────────────────────────────
   notifyRequestApproved
   Admin ne request approve ki
   Notify: requester + requestedFor (jiske liye tha, agar requester se alag hai)
───────────────────────────────────────── */
export async function notifyRequestApproved({ request, requesterId, requestedForId, newUserName }) {
  const msg = `✅ Aapki "${request.type}" account request approve ho gayi! Naya user: ${newUserName}`

  if (requesterId) {
    await createNotif(requesterId, "general", msg, {
      senderName: "Admin",
      senderRole: "admin",
      targetPage: "my-network",
    })
  }

  // Agar requestedFor requester se alag hai, use bhi batao
  if (requestedForId && String(requestedForId) !== String(requesterId)) {
    await createNotif(requestedForId, "general",
      `✅ Aapke liye naya "${request.type}" account create ho gaya hai: ${newUserName}`, {
        senderName: "Admin",
        senderRole: "admin",
        targetPage: "my-network",
      })
  }
}

/* ─────────────────────────────────────────
   notifyRequestRejected
   Admin ne request reject ki
   Notify: requester + requestedFor (agar alag hai)
───────────────────────────────────────── */
export async function notifyRequestRejected({ request, requesterId, requestedForId }) {
  const msg = `❌ Aapki "${request.type}" account request reject ho gayi (${request.name})`

  if (requesterId) {
    await createNotif(requesterId, "general", msg, {
      senderName: "Admin",
      senderRole: "admin",
      targetPage: "raise-request",
    })
  }

  if (requestedForId && String(requestedForId) !== String(requesterId)) {
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
