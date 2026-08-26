// backend/services/mailServerClient.js
import dotenv from "dotenv"
dotenv.config()

const MAIL_SERVER_URL = process.env.MAIL_SERVER_URL || "http://localhost:4000"
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
    const cleanTo = to.replace(/[^a-zA-Z0-9_@-]/g, "").toLowerCase().split("@")[0]
    const res = await fetch(`${MAIL_SERVER_URL}/provision/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAIL_API_KEY
      },
      body: JSON.stringify({
        to: cleanTo,
        subject: subject || "EDUCA VEDA Security Notification",
        body: body || "You have a new update from EDUCA VEDA."
      })
    })
    return { success: res.ok }
  } catch (err) {
    console.error("EDUCA Mail send error:", err.message)
    return { success: false }
  }
}
