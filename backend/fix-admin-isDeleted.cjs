// Run once: node fix-admin-isDeleted.cjs
// Purpose: Legacy admin@gmail.com account mein 'isDeleted' field missing thi,
// jiski wajah se admin ko koi notification nahi mil rahi thi.

const mongoose = require("mongoose")

mongoose.connect("mongodb://127.0.0.1:27017/ecommerce")

async function fixAdmin() {
  try {
    const result = await mongoose.connection.collection("users").updateMany(
      { role: "admin", isDeleted: { $exists: false } },
      { $set: { isDeleted: false } }
    )
    console.log("✅ Fixed admins:", result.modifiedCount)
    process.exit()
  } catch (err) {
    console.error("❌ Error:", err)
    process.exit(1)
  }
}

fixAdmin()
