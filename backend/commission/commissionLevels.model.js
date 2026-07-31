import mongoose from "mongoose"

const commissionSchema = new mongoose.Schema(
  {
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true
    },
    
    // ⭐ NEW PPC Fields
    ppcCount: {
      type: Number,
      default: 0
    },
    
    ppcBaseRate: {
      type: Number,
      default: 40
    },
    
    positionType: {
      type: String,
      enum: ["direct", "parent", "distributor"],
      default: "direct"
    },
    
    percentageShare: {
      type: Number,
      default: 50
    },
    
    rupeeValue: {
      type: Number,
      default: 0
    },
    
    // Legacy fields
    amount: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    
    status: {
      type: String,
      enum: ["pending", "approved", "confirmed"],
      default: "approved"
    },
    
    walletType: {
      type: String,
      default: "sellerWallet"
    },

    // ✅ Chain snapshot — actual names of all recipients
    // Frontend mein generic "Direct Seller" ki jagah real names dikhao
    chainInfo: {
      directSellerName: { type: String, default: "" },
      distributorName:  { type: String, default: "" },
      parentSellerName: { type: String, default: "" },
      isUserOrder:      { type: Boolean, default: false },
    },

    // ✅ FIX: User order hai ya seller order — frontend ke liye
    isUserOrder: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
)

commissionSchema.index({ toUser: 1, orderId: 1 })
commissionSchema.index({ orderId: 1 })

export default mongoose.model("Commission", commissionSchema)