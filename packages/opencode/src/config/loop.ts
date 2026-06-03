export * as ConfigLoop from "./loop"

import { Schema } from "effect"

// Configuration for the autonomous goal loop. When enabled, the agent keeps
// re-prompting itself after it would normally stop, until either the
// completion marker (`until`) appears in its final response or the iteration
// cap (`max_iterations`) is reached.
export const Info = Schema.Struct({
  max_iterations: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of autonomous continuations before the loop stops. Defaults to 10.",
  }),
  until: Schema.optional(Schema.String).annotate({
    description:
      "Marker string. When the assistant's final response contains this text, the loop is considered complete and stops.",
  }),
  prompt: Schema.optional(Schema.String).annotate({
    description: "Message injected to nudge the agent to continue on each iteration.",
  }),
}).annotate({ identifier: "Loop" })
export type Info = Schema.Schema.Type<typeof Info>
