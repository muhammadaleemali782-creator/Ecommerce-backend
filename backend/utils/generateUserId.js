/**
 * generateUserId.js — NEW NAMING CONVENTION
 *
 * DISTRIBUTOR: Global counter, no parent prefix
 *   Any role creates distributor → DB001, DB002, DB003... (system-wide unique)
 *
 * SELLER: Parent distributor prefix + global DS counter
 *   DB001 creates seller → DB001/DS001
 *   DB002 creates seller → DB002/DS001  (DS counter is global, finds next unique)
 *   DB001 creates another seller → DB001/DS002
 *   DS001 creates seller → DS001's parent distributor prefix + DS00X
 *
 * USER: Parent seller full prefix + global US counter
 *   DB001/DS001 creates user → DB001/DS001/US001
 *   DB001/DS001 creates another user → DB001/DS001/US002
 *   DB001/DS002 creates user → DB001/DS002/US001
 */

export const generateUserId = async (role, UserModel, parentName = null) => {

  /* ── Role prefix ── */
  let prefix = ""
  if (role === "distributor") prefix = "DB"
  if (role === "seller")      prefix = "DS"
  if (role === "user")        prefix = "US"
  if (!prefix) throw new Error(`Unknown role: ${role}`)

  /* =========================================
     DISTRIBUTOR — sirf global DB counter
     No parent prefix at all
  ========================================= */
  if (role === "distributor") {
    // Find all existing DB*** names globally
    const existing = await UserModel.find({
      name: { $regex: /^DB\d+$/ }
    }).select("name").lean()

    const usedNums = new Set()
    existing.forEach(u => {
      const num = parseInt(u.name.replace("DB", ""), 10)
      if (!isNaN(num)) usedNums.add(num)
    })

    let next = 1
    while (usedNums.has(next)) next++
    return `DB${String(next).padStart(3, "0")}`
  }

  /* =========================================
     SELLER — find nearest distributor prefix
     Format: <distPrefix>/DS<perDistNum>
     DS counter is PER distributor, not global
  ========================================= */
  if (role === "seller") {
    const distPrefix = getDistributorPrefix(parentName)

    if (distPrefix) {
      // Find existing sellers ONLY under this specific distributor prefix
      const existing = await UserModel.find({
        name: { $regex: new RegExp(`^${distPrefix}/DS\\d+$`) }
      }).select("name").lean()

      const usedNums = new Set()
      existing.forEach(u => {
        const match = u.name.match(/DS(\d+)$/)
        if (match) usedNums.add(parseInt(match[1], 10))
      })

      let next = 1
      while (usedNums.has(next)) next++
      return `${distPrefix}/DS${String(next).padStart(3, "0")}`
    } else {
      // No distributor prefix — fallback global DS counter
      const existing = await UserModel.find({
        name: { $regex: /^DS\d+$/ }
      }).select("name").lean()

      const usedNums = new Set()
      existing.forEach(u => {
        const match = u.name.match(/^DS(\d+)$/)
        if (match) usedNums.add(parseInt(match[1], 10))
      })

      let next = 1
      while (usedNums.has(next)) next++
      return `DS${String(next).padStart(3, "0")}`
    }
  }

  /* =========================================
     USER — parent seller full name + US<perSellerNum>
     US counter is PER seller, not global
  ========================================= */
  if (role === "user") {
    const sellerPrefix = getSellerPrefix(parentName)

    if (sellerPrefix) {
      // Find existing users ONLY under this specific seller
      const existing = await UserModel.find({
        name: { $regex: new RegExp(`^${sellerPrefix.replace(/\//g, "\\/")}\/US\\d+$`) }
      }).select("name").lean()

      const usedNums = new Set()
      existing.forEach(u => {
        const match = u.name.match(/US(\d+)$/)
        if (match) usedNums.add(parseInt(match[1], 10))
      })

      let next = 1
      while (usedNums.has(next)) next++
      return `${sellerPrefix}/US${String(next).padStart(3, "0")}`
    } else {
      // Fallback global
      const existing = await UserModel.find({
        name: { $regex: /US\d+$/ }
      }).select("name").lean()

      const usedNums = new Set()
      existing.forEach(u => {
        const match = u.name.match(/US(\d+)$/)
        if (match) usedNums.add(parseInt(match[1], 10))
      })

      let next = 1
      while (usedNums.has(next)) next++
      return `US${String(next).padStart(3, "0")}`
    }
  }
}

/* =============================================
   HELPER: parentName se DB prefix nikalo
   "DB001"         → "DB001"
   "DB001/DS001"   → "DB001"
   "DB002/DS003"   → "DB002"
   null            → null
============================================= */
function getDistributorPrefix(parentName) {
  if (!parentName) return null
  const parts = parentName.split("/")
  // DB part always comes first
  const dbPart = parts.find(p => p.startsWith("DB"))
  return dbPart || null
}

/* =============================================
   HELPER: parentName se seller prefix nikalo
   "DB001/DS001"        → "DB001/DS001"
   "DB001/DS001/US001"  → "DB001/DS001"  (up to DS part)
   "DB001"              → "DB001"         (no seller, use dist)
   null                 → null
============================================= */
function getSellerPrefix(parentName) {
  if (!parentName) return null
  const parts = parentName.split("/")
  // Find up to and including DS part
  const dsIdx = parts.findIndex(p => p.startsWith("DS"))
  if (dsIdx !== -1) {
    return parts.slice(0, dsIdx + 1).join("/")
  }
  // No DS found — use full parentName
  return parentName
}
