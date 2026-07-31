import mongoose from "mongoose"

const serviceSchema = new mongoose.Schema(
  {
    // ⭐ Service Basic Info
    title: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      trim: true,
      default: ""
    },

    // ⭐ Jab user is service card pe click kare to yahi link khulega
    link: {
      type: String,
      required: true,
      trim: true
    },

    // internal = app ke andar hi navigate karega (/store, /orders, etc.)
    // external = naye tab mein khulega (https://...)
    linkType: {
      type: String,
      enum: ["internal", "external"],
      default: "external"
    },

    image: {
      type: String,
      default: ""
    },

    // ⭐ Card display style
    type: {
      type: String,
      enum: ["square", "video", "banner", "round", "list"],
      default: "square"
    },

    // ⭐ Partition / Section — services ko group karne ke liye (e.g. "Blogs", "Offers", "Videos")
    category: {
      type: String,
      trim: true,
      default: "General"
    },

    // ⭐ Display order (kam number pehle dikhega)
    order: {
      type: Number,
      default: 0
    },

    // ⭐ Soft toggle — admin chahe to bina delete kiye hide kar sake
    isActive: {
      type: Boolean,
      default: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
)

serviceSchema.index({ isActive: 1, category: 1, order: 1 })

export default mongoose.model("Service", serviceSchema)
