import mongoose from "mongoose"

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  logo: String,
  createdBy: { type: String, default: "admin" }
}, { timestamps: true })

export default mongoose.model("Company", companySchema)