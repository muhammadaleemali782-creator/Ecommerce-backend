import express from "express"
import { getNextUserId } from "../useridapi/generateUserIdController.js"

const router = express.Router()

router.get("/generate-id", getNextUserId)

export default router
