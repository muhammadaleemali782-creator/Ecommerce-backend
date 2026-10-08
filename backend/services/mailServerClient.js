// backend/services/mailServerClient.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import zlib from "zlib"
import bcrypt from "bcryptjs"
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

const userSchema = new mongoose.Schema({
  product: { type: String, required: true, lowercase: true, trim: true, index: true },
  identifier: { type: String, required: true, lowercase: true, trim: true },
  displayName: { type: String, default: "", trim: true },
  passwordHash: { type: String, required: true },
  phone: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
})
userSchema.index({ product: 1, identifier: 1 }, { unique: true })

let DirectMessageModel = null
let DirectUserModel = null
if (mailDbConn) {
  DirectMessageModel = mailDbConn.model("DirectMailMessage", messageSchema, "messages")
  DirectUserModel = mailDbConn.model("DirectMailUser", userSchema, "users")
}

const deflate = (str) => zlib.deflateRawSync(Buffer.from(str || '', 'utf8'))

/* ── Auto-provision mailbox for new EDUCA user ── */
export const provisionMailbox = async ({ identifier, password, passwordHash }) => {
  try {
    if (!identifier || (!password && !passwordHash)) return { success: false, message: "Missing credentials" }
    const rawId = String(identifier).trim().toLowerCase()
    const cleanPass = String(password || "")
    const baseId = rawId.split("@")[0]

    // 1. Direct MongoDB write to Mailbox DB for zero-latency instant sync
    if (DirectUserModel) {
      try {
        const hash = passwordHash || (await bcrypt.hash(cleanPass, 12))
        await DirectUserModel.updateOne(
          { product: "educa", identifier: rawId },
          { $set: { passwordHash: hash, failedAttempts: 0, lockedUntil: null } },
          { upsert: true }
        )
        if (!rawId.includes("@")) {
          await DirectUserModel.updateOne(
            { product: "educa", identifier: `${baseId}@educa.com` },
            { $set: { passwordHash: hash, failedAttempts: 0, lockedUntil: null } },
            { upsert: true }
          )
        }
        console.log(`⚡ [provisionMailbox] Instant Direct DB user provisioned for ${rawId} & ${baseId}@educa.com`)
      } catch (dbErr) {
        console.warn("Direct Mail DB user write notice:", dbErr.message)
      }
    }

    // 2. HTTP Fallback to Mail Server — fire-and-forget (no await, don't block response)
    if (cleanPass) {
      fetch(`${MAIL_SERVER_URL}/provision/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": MAIL_API_KEY
        },
        body: JSON.stringify({
          identifier: rawId.includes("@") ? rawId : `${baseId}@educa.com`,
          password: cleanPass
        })
      }).then(r => r.json()).then(d => {
        console.log(`📧 [provisionMailbox] HTTP fallback done for ${rawId}:`, d?.message || "ok")
      }).catch(e => {
        console.warn(`📧 [provisionMailbox] HTTP fallback notice for ${rawId}:`, e.message)
      })
    }
    return { success: true }
  } catch (err) {
    console.error("EDUCA Mail provision notice:", err.message)
    return { success: false, error: err.message }
  }
}

/* ── Send transactional / OTP email into user's EDUCA Mailbox (Instant Single-Delivery) ── */
export const sendEducaMail = async ({ to, subject, body }) => {
  try {
    const rawTo = (to || "").trim().toLowerCase()
    
    // 1. Instant Direct MongoDB Save (Single Unique Record, Zero Lag)
    if (DirectMessageModel) {
      try {
        await DirectMessageModel.create({
          product: "educa",
          from: "no-reply@educa.com",
          to: rawTo,
          subject: deflate(subject || "EDUCA VEDA Security Notification"),
          body: deflate(body || "You have a new update from EDUCA VEDA."),
          flags: 0
        })
        console.log(`⚡ [sendEducaMail] Instant DB write successful for ${rawTo}`)
      } catch (dbErr) {
        console.warn("Direct Mail DB write notice:", dbErr.message)
      }
    } else {
      // 2. HTTP Fallback if DB connection isn't available
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
        console.warn("HTTP mail notice:", httpErr.message)
      }
    }

    return { success: true }
  } catch (err) {
    console.error("EDUCA Mail send error:", err.message)
    return { success: false, error: err.message }
  }
}

/* ── Update password in EDUCA Mail Server ── */
export const updateMailboxPassword = async ({ identifier, newPassword, passwordHash }) => {
  try {
    if (!identifier || (!newPassword && !passwordHash)) return { success: false }
    const rawId = String(identifier).trim().toLowerCase()
    const cleanPass = String(newPassword || "")

    // 1. Direct MongoDB write to Mailbox DB for zero-latency instant sync
    if (DirectUserModel) {
      try {
        const hash = passwordHash || (await bcrypt.hash(cleanPass, 12))
        const baseId = rawId.split("@")[0]
        await DirectUserModel.updateMany(
          {
            $or: [
              { identifier: rawId },
              { identifier: baseId },
              { identifier: `${baseId}@educaveda.com` },
              { identifier: `${baseId}@educa.com` }
            ]
          },
          { $set: { passwordHash: hash, failedAttempts: 0, lockedUntil: null } }
        )
        console.log(`⚡ [updateMailboxPassword] Instant Direct DB password updated for ${rawId}`)
      } catch (dbErr) {
        console.warn("Direct Mail DB update password notice:", dbErr.message)
      }
    }

    // 2. HTTP Fallback to Mail Server — fire-and-forget
    if (cleanPass) {
      fetch(`${MAIL_SERVER_URL}/provision/update-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": MAIL_API_KEY
        },
        body: JSON.stringify({
          identifier: rawId,
          newPassword: cleanPass
        })
      }).catch(e => console.warn(`[updateMailboxPassword] HTTP notice:`, e.message))
    }
    return { success: true }
  } catch (err) {
    console.error("EDUCA Mail update password notice:", err.message)
    return { success: false }
  }
}

/* ── Delete user from EDUCA Mail Server (When blocked or deleted in Store) ── */
export const deleteMailboxUser = async ({ identifier }) => {
  try {
    if (!identifier) return { success: false }
    const rawId = String(identifier).trim().toLowerCase()
    const baseId = rawId.split("@")[0]

    // 1. Direct MongoDB delete
    if (DirectUserModel) {
      try {
        await DirectUserModel.deleteMany({
          $or: [
            { identifier: rawId },
            { identifier: baseId },
            { identifier: `${baseId}@educaveda.com` },
            { identifier: `${baseId}@educa.com` }
          ]
        })
        console.log(`⚡ [deleteMailboxUser] Instant Direct DB user deleted: ${rawId}`)
      } catch (dbErr) {
        console.warn("Direct Mail DB delete notice:", dbErr.message)
      }
    }

    // 2. HTTP Fallback — fire-and-forget
    fetch(`${MAIL_SERVER_URL}/provision/delete-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAIL_API_KEY
      },
      body: JSON.stringify({
        identifier: rawId
      })
    }).catch(e => console.warn(`[deleteMailboxUser] HTTP notice:`, e.message))
    return { success: true }
  } catch (err) {
    console.error("EDUCA Mail delete user notice:", err.message)
    return { success: false }
  }
}

/* ── Verify user against EDUCA Mail Server & DB ── */
export const verifyMailboxUser = async (identifier, password) => {
  try {
    if (!identifier) return null
    let cleanId = String(identifier).trim().toLowerCase()
    if (cleanId.endsWith("@gmail.com")) {
      cleanId = cleanId.replace(/@gmail\.com$/i, "@educa.com")
    }

    const baseId = cleanId.split("@")[0]
    const candidates = [cleanId]

    if (cleanId.endsWith("@educa.com")) {
      candidates.push(cleanId.replace(/@educa\.com$/, "@educaveda.com"))
      candidates.push(cleanId.replace(/@educa\.com$/, "@educa"))
      candidates.push(baseId)
    } else if (cleanId.endsWith("@educaveda.com")) {
      candidates.push(cleanId.replace(/@educaveda\.com$/, "@educa.com"))
      candidates.push(cleanId.replace(/@educaveda\.com$/, "@educa"))
      candidates.push(baseId)
    } else if (cleanId.endsWith("@educa")) {
      candidates.push(cleanId.replace(/@educa$/, "@educa.com"))
      candidates.push(cleanId.replace(/@educa$/, "@educaveda.com"))
      candidates.push(baseId)
    } else if (!cleanId.includes("@")) {
      candidates.push(`${cleanId}@educa.com`, `${cleanId}@educaveda.com`, `${cleanId}@educa`)
    }

    const uniqueCandidates = [...new Set(candidates.filter(Boolean))]

    let mailUsers = []
    // 1. Direct MongoDB search
    if (DirectUserModel) {
      mailUsers = await DirectUserModel.find({ identifier: { $in: uniqueCandidates } })
    }

    if ((!mailUsers || mailUsers.length === 0) && mailDbConn?.db) {
      try {
        const rawCol = mailDbConn.db.collection("users")
        mailUsers = await rawCol.find({ identifier: { $in: uniqueCandidates } }).toArray()
      } catch (err) {}
    }

    // 2. HTTP Fallback to mail server if direct DB didn't find
    if (!mailUsers || mailUsers.length === 0) {
      try {
        const httpRes = await fetch(`${MAIL_SERVER_URL}/provision/verify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": MAIL_API_KEY
          },
          body: JSON.stringify({ identifier: cleanId, password: password ? String(password).trim() : "" })
        })
        if (httpRes.ok) {
          const httpData = await httpRes.json()
          if (httpData && httpData.user) {
            return {
              user: httpData.user,
              passwordMatch: !!httpData.passwordMatch
            }
          }
        }
      } catch (httpErr) {}
    }

    if (!mailUsers || mailUsers.length === 0) return null

    if (password) {
      const cleanPass = String(password).trim()
      for (const u of mailUsers) {
        if (u.passwordHash && await bcrypt.compare(cleanPass, u.passwordHash)) {
          return { user: u, passwordMatch: true }
        }
      }
      return { user: mailUsers[0], passwordMatch: false }
    }

    return { user: mailUsers[0], passwordMatch: false }
  } catch (err) {
    console.warn("Educa Mailbox verification notice:", err.message)
    return null
  }
}

