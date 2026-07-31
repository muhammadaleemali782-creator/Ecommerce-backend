import mongoose from "mongoose"

const productSchema = new mongoose.Schema(
  {
    // ⭐ Product Basic Info
    title: { 
      type: String, 
      required: true, 
      trim: true 
    },
    
    price: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    
    description: { 
      type: String, 
      trim: true 
    },
    
    category: { 
      type: String, 
      trim: true 
    },
    
    image: { 
      type: String, 
      default: "" 
    },
    
    // ⭐ NEW PPC SYSTEM
    // Kitni PPC milegi is product pe (1, 2, 5, etc.)
    ppcReward: { 
      type: Number, 
      default: 1,
      min: 0
    },
    
    // ⭐ Role-based Product Assignment
    // null = Admin product (sab ko visible)
    // ObjectId = Specific distributor ka product
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    
    // ⭐ Soft Delete Support
    isActive: { 
      type: Boolean, 
      default: true 
    }
  },
  { 
    timestamps: true  // createdAt, updatedAt auto add
  }
)

// ⭐ Index for better performance
productSchema.index({ distributorId: 1, isActive: 1 })
productSchema.index({ title: "text" })  // Text search support

export default mongoose.model("Product", productSchema)