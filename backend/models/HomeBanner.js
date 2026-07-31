import mongoose from "mongoose"

/* =====================================================
   HOME BANNER MODEL
   Admin dashboard se home page ka hero banner control karne ke liye.
   Ek banner image, gif, ya video ho sakta hai.
   Multiple active banners ho to home page pe auto-carousel chalega.
===================================================== */
const homeBannerSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    eyebrow: { type: String, default: "" }, // chhota badge text, e.g. "⭐ Trustpilot rating 4.3/5"
    align: { type: String, enum: ["left", "center"], default: "left" },

    buttonText: { type: String, default: "" },
    buttonLink: { type: String, default: "" },
    linkType: { type: String, enum: ["internal", "external"], default: "internal" },

    // ⭐ image | gif | video (desktop / default media)
    mediaType: { type: String, enum: ["image", "gif", "video"], default: "image" },
    media: { type: String, default: "" }, // /uploads/xxxx.ext

    // ⭐ Optional alag media mobile ke liye — agar khali ho to "media" hi mobile pe bhi chalega
    mediaTypeMobile: { type: String, enum: ["image", "gif", "video", ""], default: "" },
    mediaMobile: { type: String, default: "" },

    // ⭐ Yeh banner home page pe KAHAN dikhega:
    // "hero"  = top ka bada full-width banner (carousel)
    // "slot1"/"slot2"/"slot3" = beech-beech mein chhote vertical ad slots
    //   (agar kisi slot ke liye koi active banner na ho, to wahan kuch reserve nahi hota — normal page hi dikhta hai)
    placement: { type: String, enum: ["hero", "slot1", "slot2", "slot3"], default: "hero" },

    // Text readability ke liye dark overlay on/off
    overlay: { type: Boolean, default: true },

    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
)

homeBannerSchema.index({ isActive: 1, placement: 1, order: 1 })

export default mongoose.model("HomeBanner", homeBannerSchema)
