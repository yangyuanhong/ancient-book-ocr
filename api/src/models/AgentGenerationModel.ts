import mongoose, { Schema } from "mongoose";
import { AgentGenerationDocument } from "./types/index.js";

const agentGenerationSchema = new Schema<AgentGenerationDocument>(
  {
    generationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    originalPrompt: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    lastSequence: {
      type: Number,
      default: 0,
    },
    deltas: {
      type: [{ sequence: Number, delta: String }],
      default: [],
    },
    status: {
      type: String,
      enum: ["running", "cancelled", "completed", "failed"],
      default: "running",
    },
    error: String,
  },
  {
    timestamps: true,
  },
);

export const AgentGenerationModel = mongoose.model("AgentGeneration", agentGenerationSchema);
