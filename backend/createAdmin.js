import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import dotenv from "dotenv"
dotenv.config()

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: "user" },
  isDeleted: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  mustChangePassword: { type: Boolean, default: false },
}, { timestamps: true })

const User = mongoose.models.User || mongoose.model("User", userSchema)

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("✅ MongoDB Atlas connected")

    const existing = await User.findOne({ email: "admin@gmail.com" })
    if (existing) {
      console.log("⚠️ Admin already exists!")
      process.exit(0)
    }

    const hashed = await bcrypt.hash("12345", 10)
    await User.create({
      name: "Admin",
      email: "admin@gmail.com",
      password: hashed,
      role: "admin",
    })

    console.log("✅ Admin created successfully!")
    console.log("   Email: admin@gmail.com")
    console.log("   Password: 12345")
    process.exit(0)
  } catch (err) {
    console.error("❌ Error:", err.message)
    process.exit(1)
  }
}

createAdmin()
