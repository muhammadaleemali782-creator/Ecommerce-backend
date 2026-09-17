/* =====================================================
   ID VALIDATION — Aadhar Number / PAN Card Number
   ===================================================== */

// Aadhar: exactly 12 digits
const AADHAR_REGEX = /^[0-9]{12}$/

// PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

export function validateIdNumber(idType, idNumber) {
  if (!idType || !["aadhar", "pan"].includes(idType)) {
    return { valid: false, message: "ID type select karo — Aadhar ya PAN" }
  }

  const value = (idNumber || "").trim().toUpperCase()

  if (!value) {
    return { valid: false, message: "Aadhar ya PAN number daalo (koi ek zaroori hai)" }
  }

  if (idType === "aadhar" && !AADHAR_REGEX.test(value)) {
    return { valid: false, message: "Aadhar number 12 digit ka hona chahiye" }
  }

  if (idType === "pan" && !PAN_REGEX.test(value)) {
    return { valid: false, message: "PAN number sahi format mein nahi hai (e.g. ABCDE1234F)" }
  }

  return { valid: true, value }
}

export function validateIndianPhone(phone, isRequired = false) {
  if (!phone || !String(phone).trim()) {
    if (isRequired) return { valid: false, message: "Mobile number zaroori hai" }
    return { valid: true, value: "" }
  }

  let digits = String(phone).replace(/\D/g, "")
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2)
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1)
  }

  if (digits.length !== 10) {
    return { valid: false, message: "Mobile number exactly 10 digit ka hona chahiye (bina 0 ya +91 ke)" }
  }

  return { valid: true, value: digits }
}
