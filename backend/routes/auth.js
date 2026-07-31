import express from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import User from "../models/User.js"

const router = express.Router()

// AUTO ADMIN CREATE
router.get("/seed", async(req,res)=>{
  const admin = await User.findOne({ role:"admin" })
  if(admin) return res.json("Admin exists")

  const hash = await bcrypt.hash("admin123",10)
  await User.create({
    name:"Admin",
    email:"admin@gmail.com",
    password:hash,
    role:"admin"
  })
  res.json("Admin created")
})

// LOGIN
router.post("/login", async(req,res)=>{
  const { email, password } = req.body
  const user = await User.findOne({ email })
  if(!user) return res.json({success:false})

  const ok = await bcrypt.compare(password, user.password)
  if(!ok) return res.json({success:false})

  const token = jwt.sign(
    { id:user._id, role:user.role },
    process.env.JWT_SECRET
  )

  res.json({ success:true, token, user })
})

export default router
