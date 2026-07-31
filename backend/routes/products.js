

import express from "express"
import multer from "multer"
import protect from "../middleware/auth.js"
import allowRoles from "../middleware/allowRoles.js"
import Product from "../models/Product.js"  // ⭐ MongoDB model import

const router = express.Router()

// Upload config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/")
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname)
  }
})

const upload = multer({ storage: storage })

/* ================= ADMIN ONLY ================= */

// ⭐ ADD PRODUCT (with PPC)
router.post(
  "/admin/add-product",
  protect,
  allowRoles("admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      const { title, price, ppcReward, assignAllUsers } = req.body  // ⭐ ppcReward added
      
      if (!title || !price) {
        return res.status(400).json({ message: "Title and price required" })
      }
      
      // Create product in MongoDB
      const newProduct = await Product.create({
        title: title.trim(),
        price: Number(price),
        ppcReward: Number(ppcReward) || 1,  // ⭐ Default 1 PPC
        image: req.file ? `/uploads/${req.file.filename}` : "",
        distributorId: null,  // Admin product (visible to all)
        isActive: true
      })
      
      console.log("✅ Product created:", newProduct.title, `(${newProduct.ppcReward} PPC)`)
      
      // Optional: Assign to all users if checkbox selected
      if (assignAllUsers === "true" || assignAllUsers === true) {
        const User = (await import("../models/User.js")).default
        await User.updateMany(
          {},
          { $addToSet: { assignedProducts: newProduct._id } }
        )
        console.log("✅ Product assigned to all users")
      }
      
      res.json({ 
        success: true, 
        message: "Product added successfully",
        product: newProduct 
      })
      
    } catch (err) {
      console.error("❌ Add product error:", err)
      res.status(500).json({ message: "Failed to add product" })
    }
  }
)

// ⭐ GET ALL PRODUCTS
router.get("/", protect, async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ createdAt: -1 })
    
    res.json(products)
  } catch (err) {
    console.error("Get products error:", err)
    res.status(500).json({ message: "Failed to load products" })
  }
})

// ⭐ GET PUBLIC PRODUCTS (no auth needed)
router.get("/public", async (req, res) => {
  try {
    const products = await Product.find({ 
      distributorId: null,
      isActive: true 
    }).sort({ createdAt: -1 })
    
    res.json(products)
  } catch (err) {
    res.status(500).json({ message: "Failed to load products" })
  }
})

// ⭐ UPDATE PRODUCT
router.put(
  "/admin/update-product/:id",
  protect,
  allowRoles("admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      const { title, price, ppcReward } = req.body
      
      const product = await Product.findById(req.params.id)
      if (!product) {
        return res.status(404).json({ message: "Product not found" })
      }
      
      if (title) product.title = title
      if (price) product.price = Number(price)
      if (ppcReward !== undefined) product.ppcReward = Number(ppcReward)  // ⭐ Update PPC
      if (req.file) product.image = `/uploads/${req.file.filename}`
      
      await product.save()
      
      res.json({ 
        success: true, 
        message: "Product updated",
        product 
      })
      
    } catch (err) {
      console.error("Update product error:", err)
      res.status(500).json({ message: "Failed to update product" })
    }
  }
)

// ⭐ DELETE PRODUCT
router.delete(
  "/admin/delete-product/:id",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id)
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" })
      }
      
      // Soft delete
      product.isActive = false
      await product.save()
      
      // Or hard delete
      // await Product.findByIdAndDelete(req.params.id)
      
      res.json({ 
        success: true, 
        message: "Product deleted" 
      })
      
    } catch (err) {
      console.error("Delete product error:", err)
      res.status(500).json({ message: "Failed to delete product" })
    }
  }
)

export default router