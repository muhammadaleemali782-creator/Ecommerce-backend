// backend/services/mailServerClient.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import zlib from "zlib"
dotenv.config()

const MAIL_SERVER_URL = process.env.MAIL_SERVER_URL || "https://messages-backend-e6pe.onrender.com"
const MAIL_API_KEY = process.env.MAIL_API_KEY || "educa_mail_master_key_secure"
const MAIL_DB_URI = process.env.MAIL_DB_URI || "mongodb+srv://luciferop36_db_user:atIt54yOD2blC1lI@cluster0.2m4wpyj.mongodb.net/messagesdb?appName=Cluster0"

// Direct MongoDB Connection to Mail Server DB for Instant Zero-Delay Delivery
let mailDbConn = null
try {
  mailDbConn = mongoose.createConnection(MAIL_DB_URI)
  console.log("⚡ Connected direct pipeline to EDUCA Mail MongoDB!")
} catch (e) {
  console.warn("Mail DB direct connection warning:", e.message)
}

const messageSchema = new mongoose.Schema({
  product: { type: String, required: true, lowercase: true, trim: true, index: true },
  from: { type: String, required: true, lowercase: true, trim: true, index: true },
  to: { type: String, required: true, lowercase: true, trim: true, index: true },
  ts: { type: Date, default: Date.now },
  subject: { type: Buffer, required: true },
  body: { type: Buffer, required: true },
  flags: { type: Number, default: 0 }
})

let DirectMessageModel = null
if (mailDbConn) {
  DirectMessageModel = mailDbConn.model("DirectMailMessage", messageSchema, "messages")
}

const deflate = (str) => zlib.deflateRawSync(Buffer.from(str || '', 'utf8'))

/* ── Auto-provision mailbox for new EDUCA user ── */
export const provisionMailbox = async ({ identifier, password }) => {
  try {
    if (!identifier || !password) return { success: false, message: "Missing credentials" }
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
    console.error("EDUCA Mail provision notice:", err.message)
    return { success: false, error: err.message }
  }
}

/* ── Send transactional / OTP email into user's EDUCA Mailbox (Instant Dual-Delivery) ── */
export const sendEducaMail = async ({ to, subject, body }) => {
  try {
    const rawTo = (to || "").trim().toLowerCase()
    const cleanId = rawTo.includes("@") ? rawTo.split("@")[0] : rawTo
    const domainEmail = rawTo.includes("@") ? rawTo : `${rawTo}@educaveda.com`
    
    // 1. Instant Direct MongoDB Save (Zero Latency, No Cold Starts)
    if (DirectMessageModel) {
      try {
        const recipients = Array.from(new Set([rawTo, cleanId, domainEmail]))
        for (const recipient of recipients) {
          await DirectMessageModel.create({
            product: "educa",
            from: "no-reply@educaveda.com",
            to: recipient,
            subject: deflate(subject || "EDUCA VEDA Security Notification"),
            body: deflate(body || "You have a new update from EDUCA VEDA."),
            flags: 0
          })
        }
        console.log(`⚡ [sendEducaMail] Instant DB write successful for recipients: ${recipients.join(', ')}`)
      } catch (dbErr) {
        console.warn("Direct Mail DB write warning:", dbErr.message)
      }
    }

    // 2. Also Notify HTTP Provisioning API
    try {
      await fetch(`${MAIL_SERVER_URL}/provision/message`, {
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
    } catch (httpErr) {
      // Ignored since direct DB write already secured delivery
    }

    return { success: true }
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
    console.error("EDUCA Mail update password notice:", err.message)
    return { success: false }
  }
}
