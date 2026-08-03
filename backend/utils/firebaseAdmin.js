import admin from "firebase-admin"

/*
  ⚠️ SECURITY: Service account JSON kabhi bhi GitHub pe commit MAT karo.
  Iski jagah Render dashboard me ek Environment Variable banao:

    Key:   FIREBASE_SERVICE_ACCOUNT
    Value: <poori service-account JSON file ka content, ek hi line me>

  Render → Environment tab → "Add Environment Variable" se add kar sakte ho.
*/

let firebaseApp = null
let attempted = false

export function getFirebaseAdmin() {
  if (firebaseApp) return admin
  if (attempted) return null   // pehle try fail ho chuka, dobara try mat karo
  attempted = true

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT env var missing — push notifications OFF (in-app notifications still kaam karengi)")
    return null
  }

  try {
    const serviceAccount = JSON.parse(raw)
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
    console.log("✅ Firebase Admin initialized — push notifications ON")
    return admin
  } catch (err) {
    console.error("❌ Firebase Admin init failed:", err.message)
    return null
  }
}
