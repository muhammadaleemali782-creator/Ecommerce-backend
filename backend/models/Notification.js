import mongoose from "mongoose"

const notificationSchema = new mongoose.Schema(
  {
    /* ── Recipient ── */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    /* ── Content ── */
    type: {
      type: String,
      enum: ["new_order", "dist_approved", "confirmed", "rejected", "general"],
      default: "general"
    },

    message: {
      type: String,
      required: true,
      trim: true
    },

    /* ── Sender info (jis bande ne action kiya) ── */
    senderName: { type: String, default: "" },
    senderRole: { type: String, default: "" },

    /* ── Link info ── */
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null
    },

    // Page jaha redirect karna hai click par
    targetPage: {
      type: String,
      default: ""
    },

    /* ── State ── */
    read: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  { timestamps: true }
)

notificationSchema.index({ userId: 1, createdAt: -1 })
notificationSchema.index({ userId: 1, read: 1 })

export default mongoose.model("Notification", notificationSchema)
