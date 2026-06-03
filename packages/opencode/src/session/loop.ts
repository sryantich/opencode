export * as Loop from "./loop"

import type { ConfigLoop } from "@/config/loop"

// Default cap on autonomous continuations. Keeps a misconfigured or
// never-completing loop from running forever.
export const DEFAULT_MAX_ITERATIONS = 10

export const DEFAULT_PROMPT =
  "Continue working toward the goal. When the goal is fully complete, say so explicitly in your final response."

export type Decision =
  | { action: "stop"; reason: "disabled" | "max_iterations" | "until" }
  | { action: "continue"; prompt: string }

export interface DecideInput {
  config?: ConfigLoop.Info
  // Number of autonomous continuations already performed this run.
  iteration: number
  // The assistant's most recent final text, used to detect the completion marker.
  lastText: string
}

// Pure decision for whether the agent should autonomously continue. Extracted
// so the policy can be tested without driving a real model.
export function decide(input: DecideInput): Decision {
  const config = input.config
  if (!config) return { action: "stop", reason: "disabled" }

  const max = config.max_iterations ?? DEFAULT_MAX_ITERATIONS
  if (input.iteration >= max) return { action: "stop", reason: "max_iterations" }

  if (config.until && config.until.length > 0 && input.lastText.includes(config.until)) {
    return { action: "stop", reason: "until" }
  }

  return { action: "continue", prompt: config.prompt ?? DEFAULT_PROMPT }
}
