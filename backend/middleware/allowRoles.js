/*
  =====================================================
  ROLE BASED ACCESS CONTROL (RBAC)
  -----------------------------------------------------
  ✔ Restricts route access based on user role
  ✔ Requires `protect` middleware before this
  ✔ Usage:
      allowRoles("admin")
      allowRoles("admin", "distributor")
  =====================================================
*/

export default function allowRoles(...roles) {
  return (req, res, next) => {
    // -------- Safety check --------
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User not authenticated."
      })
    }

    // -------- Role validation --------
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions."
      })
    }

    // -------- Access granted --------
    next()
  }
}
