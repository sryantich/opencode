export * as ConfigHook from "./hook"

import { Schema } from "effect"

// A single hook entry: a shell command to run when a lifecycle event fires.
//
// `command` may be a plain shell string (executed via the user's shell) or an
// argv array (executed directly without a shell). `matcher` is an optional
// regular expression that is tested against the tool name for `tool.*` events;
// when omitted, the hook runs for every tool.
export const Entry = Schema.Struct({
  command: Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))]).annotate({
    description: "Command to run, either a shell string or an argv array",
  }),
  matcher: Schema.optional(Schema.String).annotate({
    description: "Optional regular expression matched against the tool name (for tool.* events)",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Extra environment variables to set when running the command",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Maximum time in milliseconds to allow the command to run before it is killed",
  }),
})
export type Entry = Schema.Schema.Type<typeof Entry>

// Lifecycle events that a config hook can subscribe to. These map onto the
// existing plugin trigger points and session lifecycle events at runtime.
export const EVENTS = [
  "tool.execute.before",
  "tool.execute.after",
  "chat.message",
  "session.start",
  "session.idle",
] as const

export const Event = Schema.Literals(EVENTS)
export type Event = (typeof EVENTS)[number]

const Entries = Schema.optional(Schema.mutable(Schema.Array(Entry)))

export const Info = Schema.Struct({
  "tool.execute.before": Entries,
  "tool.execute.after": Entries,
  "chat.message": Entries,
  "session.start": Entries,
  "session.idle": Entries,
}).annotate({
  identifier: "Hook",
  description: "Configure shell commands to run on lifecycle events, see https://opencode.ai/docs/hooks",
})
export type Info = Schema.Schema.Type<typeof Info>
