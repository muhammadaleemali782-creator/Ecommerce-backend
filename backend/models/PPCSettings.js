import mongoose from "mongoose"

const ppcSettingsSchema = new mongoose.Schema(
  {
    // ⭐ Base PPC Value (1 PPC = ₹40)
    basePPCValue: {
      type: Number,
      default: 40,
      min: 0
    },
    
    // ⭐ Distribution Percentages
    distributionRates: {
      direct: {
        type: Number,
        default: 50,  // 50% for direct seller
        min: 0,
        max: 100
      },
      parent: {
        type: Number,
        default: 25,  // 25% for parent
        min: 0,
        max: 100
      },
      distributor: {
        type: Number,
        default: 25,  // 25% for distributor
        min: 0,
        max: 100
      }
    },

    /* ⭐ NEW: Jab "user" role wala khud sale kare (koi seller nahi) —
       tab sirf 2 parties hoti hain: uske upar wala Direct Seller + Distributor.
       Ye alag settings hain "distributionRates" (jo seller-order ke liye hai) se. */
    userOrderDistributionRates: {
      directSeller: {
        type: Number,
        default: 50,  // 50% goes to the immediate seller/distributor above the user
        min: 0,
        max: 100
      },
      distributor: {
        type: Number,
        default: 50,  // remaining 50% goes to the distributor
        min: 0,
        max: 100
      }
    },
    
    minimumWithdrawal: {
      type: Number,
      default: 1,
      min: 1
    },

    // 📊 Google Sheet Webhook URL for auto syncing withdrawal requests & QR
    googleSheetWebhookUrl: {
      type: String,
      trim: true,
      default: ""
    },

    // ⭐ Monthly Lifetime Salary Payout Date (Admin can decide any day from 1 to 28)
    salaryPayoutDay: {
      type: Number,
      default: 1,
      min: 1,
      max: 28
    },
    lastSalaryPayoutMonth: {
      type: String,
      default: ""
    },

    // ✅ Level Up Thresholds for Distributors (Dynamic)
    levelUpThresholds: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level1: 100,
        level2: 500,
        level3: 1000,
        level4: 5000
      }
    },

    // ✅ Level Up Rewards (Dynamic)
    levelRewards: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level1: "🎁 ₹500 bonus credit",
        level2: "🎁 ₹1500 bonus credit",
        level3: "🎁 ₹3000 + free kit",
        level4: "🎁 ₹10000 + trip"
      }
    },

    // ✅ Level names (Dynamic)
    levelNames: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level0: "Distributor",
        level1: "Senior Distributor",
        level2: "Gold Distributor",
        level3: "Platinum Distributor",
        level4: "Diamond Distributor"
      }
    },
    
    // ✅ Seller Level Up Thresholds (Dynamic)
    sellerLevelUpThresholds: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level1: 50,
        level2: 200,
        level3: 500,
        level4: 2000
      }
    },
    // ✅ Seller Level Rewards (Dynamic)
    sellerLevelRewards: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level1: "🎁 ₹250 bonus credit",
        level2: "🎁 ₹750 bonus credit",
        level3: "🎁 ₹1500 + free kit",
        level4: "🎁 ₹5000 + trip"
      }
    },
    // ✅ Seller Level Names (Dynamic)
    sellerLevelNames: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        level0: "Seller",
        level1: "Silver Seller",
        level2: "Gold Seller",
        level3: "Platinum Seller",
        level4: "Diamond Seller"
      }
    },

    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

ppcSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ isActive: true })
  
  if (!settings) {
    settings = await this.create({
      basePPCValue: 40,
      distributionRates: { direct: 50, parent: 25, distributor: 25 },
      minimumWithdrawal: 1,
      levelUpThresholds: { level1: 100, level2: 500, level3: 1000, level4: 5000 },
      levelNames: {
        level0: "Distributor",
        level1: "Senior Distributor",
        level2: "Gold Distributor",
        level3: "Platinum Distributor",
        level4: "Diamond Distributor"
      },
      isActive: true
    })
    console.log("✅ Default PPC settings created")
  }
  
  return settings
}

export default mongoose.models.PPCSettings || mongoose.model("PPCSettings", ppcSettingsSchema)
