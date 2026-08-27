// backend/services/mailServerClient.js
import dotenv from "dotenv"
dotenv.config()

const MAIL_SERVER_URL = process.env.MAIL_SERVER_URL || "https://messages-backend-e6pe.onrender.com"
const MAIL_API_KEY = process.env.MAIL_API_KEY || "educa_mail_master_key_secure"

/* ── Auto-provision mailbox for new EDUCA user ── */
export const provisionMailbox = async ({ identifier, password }) => {
  try {
    if (!identifier || !password) return { success: false, message: "Missing credentials" }
    
    // Clean identifier (e.g. username or email prefix)
    const cleanId = identifier.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()

    const res = await fetch(`${MAIL_SERVER_URL}/provision/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAIL_API_KEY
      },
      body: JSON.stringify({
        identifier: cleanId,
        password: password.length >= 8 ? password : `${password}12345`
      })
    })
    const data = await res.json()
    return { success: res.ok, data }
  } catch (err) {
    console.error("EDUCA Mail provision error:", err.message)
    return { success: false, error: err.message }
  }
}

/* ── Send transactional / OTP email into user's EDUCA Mailbox ── */
export const sendEducaMail = async ({ to, subject, body }) => {
  try {
    const rawTo = (to || "").trim().toLowerCase()
    const cleanId = rawTo.includes("@") ? rawTo.split("@")[0] : rawTo
    
    // Send to live mail server
    const res = await fetch(`${MAIL_SERVER_URL}/provision/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAIL_API_KEY
      },
      body: JSON.stringify({
        to: rawTo,
        subject: subject || "EDUCA VEDA Security Notification",
        body: body || "You have a new update from EDUCA VEDA."
      })
    })

    // Also send alias if it's an email format
    if (rawTo.includes("@")) {
      try {
        await fetch(`${MAIL_SERVER_URL}/provision/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": MAIL_API_KEY
          },
          body: JSON.stringify({
            to: cleanId,
            subject: subject || "EDUCA VEDA Security Notification",
            body: body || "You have a new update from EDUCA VEDA."
          })
        })
      } catch (e) {}
    }

    const data = await res.json()
    console.log(`[sendEducaMail] Result for ${rawTo}:`, data)
    return { success: res.ok, data }
  } catch (err) {
    console.error("EDUCA Mail send error:", err.message)
    return { success: false, error: err.message }
  }
}

/* ── Update password in EDUCA Mail Server ── */
export const updateMailboxPassword = async ({ identifier, newPassword }) => {
  try {
    if (!identifier || !newPassword) return { success: false }
    const cleanId = identifier.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()
    const res = await fetch(`${MAIL_SERVER_URL}/provision/update-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAIL_API_KEY
      },
      body: JSON.stringify({
        identifier: cleanId,
        newPassword: newPassword.length >= 8 ? newPassword : `${newPassword}12345`
      })
    })
    return { success: res.ok }
  } catch (err) {
    console.error("EDUCA Mail update password error:", err.message)
    return { success: false }
  }
}

