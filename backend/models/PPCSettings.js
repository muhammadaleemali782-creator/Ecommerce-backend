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
      default: 100,
      min: 0
    },

    // ✅ Level Up Thresholds for Distributors
    levelUpThresholds: {
      level1: { type: Number, default: 100,  description: "Distributor → Senior Distributor" },
      level2: { type: Number, default: 500,  description: "Senior → Gold Distributor" },
      level3: { type: Number, default: 1000, description: "Gold → Platinum Distributor" },
      level4: { type: Number, default: 5000, description: "Platinum → Diamond Distributor" },
    },

    // ✅ Level Up Rewards — admin sets reward for achieving each level
    levelRewards: {
      level1: { type: String, default: "🎁 ₹500 bonus credit"  },
      level2: { type: String, default: "🎁 ₹1500 bonus credit" },
      level3: { type: String, default: "🎁 ₹3000 + free kit"   },
      level4: { type: String, default: "🎁 ₹10000 + trip"      },
    },

    // ✅ Level names
    levelNames: {
      level0: { type: String, default: "Distributor" },
      level1: { type: String, default: "Senior Distributor" },
      level2: { type: String, default: "Gold Distributor" },
      level3: { type: String, default: "Platinum Distributor" },
      level4: { type: String, default: "Diamond Distributor" },
    },
    
    // ✅ Seller Level Up Thresholds
    sellerLevelUpThresholds: {
      level1: { type: Number, default: 50  },
      level2: { type: Number, default: 200 },
      level3: { type: Number, default: 500 },
      level4: { type: Number, default: 2000 },
    },
    // ✅ Seller Level Rewards
    sellerLevelRewards: {
      level1: { type: String, default: "🎁 ₹250 bonus credit"  },
      level2: { type: String, default: "🎁 ₹750 bonus credit"  },
      level3: { type: String, default: "🎁 ₹1500 + free kit"   },
      level4: { type: String, default: "🎁 ₹5000 + trip"       },
    },
    // ✅ Seller Level Names
    sellerLevelNames: {
      level0: { type: String, default: "Seller"          },
      level1: { type: String, default: "Silver Seller"   },
      level2: { type: String, default: "Gold Seller"     },
      level3: { type: String, default: "Platinum Seller" },
      level4: { type: String, default: "Diamond Seller"  },
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
      minimumWithdrawal: 100,
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
