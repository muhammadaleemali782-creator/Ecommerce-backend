import PPCSettings from "../models/PPCSettings.js"
import RewardClaim from "../models/RewardClaim.js"
import User from "../models/User.js"
import SalaryPayout from "../models/SalaryPayout.js"
import { createNotif } from "../utils/notifHelper.js"


/**
 * Parses salary amount in Rupees from reward text
 * Examples:
 *   "₹50000 CASH and Life time 1k salary"  -> 1000
 *   "₹150000 CASH and Life time 3k salary" -> 3000
 *   "₹500000 CASH and Life time 10k salary" -> 10000
 *   "₹1500000 CASH and Life time 15k salary" -> 15000
 *   "Life time 500 salary" -> 500
 */
export function parseSalaryAmount(rewardText) {
  if (!rewardText || typeof rewardText !== "string") return 0
  
  // 1. Matches "1k", "3k", "10k", "15k" following "salary" or "lifetime"
  const matchK = rewardText.match(/(?:life\s*time|lifetime)?\s*(\d+(?:\.\d+)?)\s*k\s*(?:salary)?/i)
  if (matchK && matchK[1]) {
    const num = parseFloat(matchK[1])
    if (!isNaN(num) && num > 0) return num * 1000
  }

  // 2. Matches "Life time ₹1000 salary" or "Life time 1000 salary"
  const matchNum = rewardText.match(/(?:life\s*time|lifetime)[^\d]*(\d[\d,]*)\s*(?:salary)?/i)
  if (matchNum && matchNum[1]) {
    const num = parseFloat(matchNum[1].replace(/,/g, ""))
    if (!isNaN(num) && num > 0) return num
  }

  // 3. Matches "1000 salary" or "₹1000 per month"
  const matchSalary = rewardText.match(/(\d[\d,]*)\s*(?:salary|per\s*month)/i)
  if (matchSalary && matchSalary[1]) {
    const num = parseFloat(matchSalary[1].replace(/,/g, ""))
    if (!isNaN(num) && num > 0) return num
  }

  return 0
}

/**
 * Execute monthly lifetime salary payout for all qualified users
 */
export async function executeMonthlySalaryPayout({ triggeredBy = "system_cron", targetMonth = null } = {}) {
  try {
    const settings = await PPCSettings.getSettings()
    const now = new Date()
    const month = targetMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    console.log(`💼 [SalaryPayout] Starting monthly lifetime salary payout for month: ${month} (triggered by ${triggeredBy})`)

    // Find all paid/approved reward claims
    const approvedClaims = await RewardClaim.find({ status: "paid" })
      .populate("userId", "name fullName role isBlocked isDeleted sellerWallet sellerWalletAsSeller")
      .lean()

    let creditedCount = 0
    let totalAmountCredited = 0
    const results = []

    for (const claim of approvedClaims) {
      const user = claim.userId
      if (!user || user.isBlocked || user.isDeleted) continue

      const salaryAmt = parseSalaryAmount(claim.rewardText)
      if (salaryAmt <= 0) continue

      // Check if already credited for this user, level, and month
      const alreadyPaid = await SalaryPayout.findOne({
        userId: user._id,
        level: claim.level,
        month
      })

      if (alreadyPaid) {
        console.log(`ℹ️ [SalaryPayout] Already paid for user ${user.name} (level ${claim.level}) for ${month}`)
        continue
      }

      // Determine wallet to credit
      const walletToCredit = user.role === "distributor" ? "sellerWallet" : "sellerWalletAsSeller"

      // 1. Create payout record
      await SalaryPayout.create({
        userId: user._id,
        userRole: user.role,
        walletType: walletToCredit,
        level: claim.level,
        levelName: claim.levelName,
        rewardText: claim.rewardText,
        salaryAmount: salaryAmt,
        month,
        creditedAt: new Date(),
        creditedBy: triggeredBy
      })

      // 2. Add to user's wallet
      await User.findByIdAndUpdate(user._id, {
        $inc: { [walletToCredit]: salaryAmt }
      })

      // 3. Send notification
      try {
        await createNotif(
          user._id,
          "general",
          `🎉 Aapki ${claim.levelName || `Level ${claim.level}`} ki is mahine (${month}) ki ₹${salaryAmt.toLocaleString("en-IN")} lifetime salary aapke wallet me add kar di gayi hai.`,
          {
            senderName: "PPC System",
            senderRole: "system",
            targetPage: user.role === "distributor" ? "ppc-statement" : "seller-dashboard"
          }
        )
      } catch (ne) {
        console.warn("[SalaryPayout] Notification error:", ne.message)
      }

      creditedCount++
      totalAmountCredited += salaryAmt
      results.push({
        userName: user.name,
        fullName: user.fullName,
        level: claim.level,
        amount: salaryAmt,
        month
      })
    }

    // Update settings with last payout month
    settings.lastSalaryPayoutMonth = month
    await settings.save()

    console.log(`✅ [SalaryPayout] Payout complete for ${month}: ${creditedCount} users credited, Total ₹${totalAmountCredited}`)
    return {
      success: true,
      month,
      creditedCount,
      totalAmountCredited,
      details: results
    }
  } catch (err) {
    console.error("❌ [SalaryPayout] Error executing salary payout:", err)
    return { success: false, error: err.message }
  }
}

/**
 * Runs periodically to check if today is the scheduled payout day
 */
export async function checkAndRunScheduledPayout() {
  try {
    const settings = await PPCSettings.getSettings()
    const payoutDay = settings.salaryPayoutDay || 1
    const now = new Date()
    const todayDate = now.getDate()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    // If today is on or after the decided payout day, and this month hasn't been processed yet
    if (todayDate >= payoutDay && settings.lastSalaryPayoutMonth !== currentMonth) {
      console.log(`📅 [SalaryPayout Scheduler] Today is ${todayDate}, configured payout day is ${payoutDay}. Running payout for ${currentMonth}...`)
      await executeMonthlySalaryPayout({ triggeredBy: "system_cron", targetMonth: currentMonth })
    }
  } catch (err) {
    console.warn("⚠️ [SalaryPayout Scheduler] Check error:", err.message)
  }
}
