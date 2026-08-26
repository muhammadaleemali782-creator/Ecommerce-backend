import mongoose from "mongoose"

const followUpNoteSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    createdByName: {
      type: String,
      default: ""
    },
    createdByFullName: {
      type: String,
      default: ""
    },
    createdByRole: {
      type: String,
      default: ""
    },
    note: {
      type: String,
      required: true,
      trim: true
    },
    contactMethod: {
      type: String,
      enum: ["call", "whatsapp", "in-person", "note"],
      default: "call"
    },
    status: {
      type: String,
      enum: ["follow_up_taken", "order_promised", "needs_support", "dormant", "general"],
      default: "follow_up_taken"
    }
  },
  { timestamps: true }
)

export default mongoose.model("FollowUpNote", followUpNoteSchema)
