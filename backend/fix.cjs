const bcrypt = require("bcryptjs")
const mongoose = require("mongoose")

/* ⭐ IMPORTANT — model ko .default se lo */
const User = require("./models/User").default

mongoose.connect("mongodb://127.0.0.1:27017/ecommerce")

async function fixUser() {
  try {
    console.log("🔄 Fixing password...")

    const hash = await bcrypt.hash("123456", 10)

    const result = await User.updateOne(
      { email: "admin@gmail.com" },
      { password: hash, mustChangePassword: false }
    )

    console.log("✅ Password fixed", result)
    process.exit()

  } catch (err) {
    console.error("❌ Error:", err)
    process.exit(1)
  }
}

fixUser()
