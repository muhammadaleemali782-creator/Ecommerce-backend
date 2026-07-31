import jwt from "jsonwebtoken"
import User from "../models/User.js"

/*
  =====================================================
  AUTH MIDDLEWARE (JWT PROTECT - FINAL SAFE VERSION)
  -----------------------------------------------------
  ✔ Reads JWT from Authorization header (Bearer <token>)
  ✔ Verifies token using JWT_SECRET
  ✔ Attaches decoded payload to req.user
  ✔ Checks blocked / deleted users 🔥
  ✔ Handles malformed tokens
  ✔ Production safe logging
  ✔ Works with MongoDB User model
  =====================================================
*/

export default async function protect(req, res, next) {
  try {

    /* -------------------------------------------------
       Extract Authorization Header
       Expected format: "Bearer <token>"
    -------------------------------------------------- */
    const authHeader = req.headers.authorization

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Authorization header missing."
      })
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format. Use Bearer token."
      })
    }

    const token = authHeader.split(" ")[1]

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Authentication token missing."
      })
    }

    /* -------------------------------------------------
       Verify JWT Token
    -------------------------------------------------- */
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "supersecretkey"
    )

    /*
      Decoded payload example:
      {
        id: userId,
        role: "admin" | "distributor" | "seller",
        iat,
        exp
      }
    */

    /* -------------------------------------------------
       OPTIONAL → CHECK USER EXISTS
    -------------------------------------------------- */
    const user = await User.findById(decoded.id)

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found."
      })
    }

    /* -------------------------------------------------
       BLOCKED / DELETED CHECK 🔥🔥🔥
    -------------------------------------------------- */
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account is blocked by admin."
      })
    }

    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: "Your account is deleted."
      })
    }

    /* -------------------------------------------------
       Attach user payload to request
    -------------------------------------------------- */
    req.user = {
      id: String(user._id),
      role: user.role,
      email: user.email
    }

    /* -------------------------------------------------
       Continue to next middleware / route
    -------------------------------------------------- */
    next()

  } catch (error) {

    console.error("AUTH ERROR:", error.message)

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again."
      })
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token."
      })
    }

    return res.status(401).json({
      success: false,
      message: "Authentication failed."
    })
  }
}