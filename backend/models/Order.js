import mongoose from "mongoose"

const orderSchema = new mongoose.Schema(
  {
    // 🔗 USER / SELLER / DISTRIBUTOR
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    nearestSellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sellerId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    distributorId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    // 🛒 ORDER DATA
    items:        { type: Array,   default: [] },
    total:        { type: Number,  required: true },
    customerName: { type: String,  trim: true },
    phone:        { type: String,  trim: true },
    address:      { type: String,  trim: true },

    // 📍 BEHALF TRACKING
    onBehalfOfId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    onBehalfOfName: { type: String, default: "" },
    onBehalfOfRole: { type: String, default: "" },
    placedById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    placedByName:   { type: String, default: "" },
    placedByRole:   { type: String, default: "" },

    // ══════════════════════════════════════════════════
    //  ORDER STATUS — 2 STAGE MANDATORY FLOW
    //
    //  pending          → Newly placed, awaiting distributor
    //  dist_approved    → Distributor approved, awaiting admin
    //  confirmed        → ✅ Admin final approve → PPC + Sales trigger
    //  rejected         → Kisi ne reject kiya
    // ══════════════════════════════════════════════════
    status: {
      type: String,
      enum: ["pending", "dist_approved", "confirmed", "rejected"],
      default: "pending",
      index: true
    },

    // ── STAGE 1: DISTRIBUTOR ──
    distributorApproved:    { type: Boolean, default: false },
    distributorApprovedAt:  { type: Date,    default: null },
    distributorNote:        { type: String,  default: "", trim: true },
    // ⭐ Kya yeh note seller/user ko dikhana hai?
    distributorNoteVisible: { type: Boolean, default: false },

    distributorRejectedAt:   { type: Date,   default: null },
    distributorRejectedNote: { type: String, default: "", trim: true },

    // ── STAGE 2: ADMIN FINAL ──
    adminApproved:    { type: Boolean, default: false },
    adminApprovedAt:  { type: Date,    default: null },
    adminNote:        { type: String,  default: "", trim: true },
    // ⭐ Kya yeh note seller/user ko dikhana hai?
    adminNoteVisible: { type: Boolean, default: false },

    // Admin bypass flag (distributor ke bina bhi approve kar sakta hai)
    approvedByAdmin:  { type: Boolean, default: false },

    // ── TIMESTAMPS ──
    confirmedAt: { type: Date,                                       default: null },
    rejectedAt:  { type: Date,                                       default: null },
    rejectedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
)

export default mongoose.model("Order", orderSchema)
