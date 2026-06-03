export * as Hook from "."

import type { Hooks } from "@opencode-ai/plugin"
import type { ConfigHook } from "@/config/hook"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "hook" })

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface ExecInput {
  command: string | string[]
  cwd: string
  env: Record<string, string>
  stdin: string
  timeout?: number
}

// An injectable command executor. The default implementation shells out via
// Bun.spawn; tests provide a fake to assert behavior without spawning.
export type Exec = (input: ExecInput) => Promise<ExecResult>

// Default executor backed by Bun.spawn. A string command is run through the
// system shell; an argv array is executed directly.
export const bunExec: Exec = async (input) => {
  const argv = typeof input.command === "string" ? ["sh", "-c", input.command] : input.command
  const proc = Bun.spawn(argv, {
    cwd: input.cwd,
    env: input.env,
    stdin: new TextEncoder().encode(input.stdin),
    stdout: "pipe",
    stderr: "pipe",
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  if (input.timeout && input.timeout > 0) {
    timer = setTimeout(() => proc.kill(), input.timeout)
  }

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Returns true when `value` matches `matcher`. A missing matcher matches
// everything. The matcher is treated as a regular expression, falling back to
// an exact string comparison when it is not valid regex.
export function matches(matcher: string | undefined, value: string): boolean {
  if (matcher === undefined || matcher === "") return true
  try {
    return new RegExp(matcher).test(value)
  } catch {
    return matcher === value
  }
}

export interface RunResult {
  // Whether the command was actually executed (false when filtered out by matcher).
  ran: boolean
  exitCode?: number
  // Parsed JSON object emitted on stdout, if any. Used to feed data back into
  // the run (e.g. replacement tool args, extra chat context).
  json?: Record<string, unknown>
}

export interface RunEntryInput {
  entry: ConfigHook.Entry
  event: string
  payload: Record<string, unknown>
  // When provided, the entry's matcher is tested against this tool name.
  toolName?: string
  cwd: string
  exec: Exec
}

// Runs a single hook entry. The full payload is provided to the command as JSON
// on stdin; a few salient fields are also exposed as environment variables for
// convenience. A stdout body that parses as a JSON object is returned so the
// caller can act on it.
export async function runEntry(input: RunEntryInput): Promise<RunResult> {
  const { entry, event, payload, toolName, cwd, exec } = input
  if (toolName !== undefined && !matches(entry.matcher, toolName)) return { ran: false }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(entry.environment ?? {}),
    OPENCODE_HOOK_EVENT: event,
  }
  if (toolName !== undefined) env.OPENCODE_TOOL = toolName
  if (typeof payload.sessionID === "string") env.OPENCODE_SESSION_ID = payload.sessionID

  const result = await exec({
    command: entry.command,
    cwd,
    env,
    stdin: JSON.stringify(payload),
    timeout: entry.timeout,
  })

  if (result.exitCode !== 0) {
    log.warn("hook command exited non-zero", {
      event,
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    })
  }

  return { ran: true, exitCode: result.exitCode, json: parseJsonObject(result.stdout) }
}

function parseJsonObject(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Non-JSON stdout is fine; treated as plain side-effect output.
  }
  return undefined
}

export interface FromConfigInput {
  hooks: ConfigHook.Info
  cwd: string
  exec?: Exec
}

// Builds a synthetic plugin `Hooks` object from config so config-defined shell
// hooks flow through the same dispatch path as code plugins.
export function fromConfig(input: FromConfigInput): Hooks {
  const exec = input.exec ?? bunExec
  const cwd = input.cwd
  const cfg = input.hooks
  const result: Hooks = {}

  const entriesFor = (event: ConfigHook.Event): ConfigHook.Entry[] => cfg[event] ?? []

  const safeRun = (i: RunEntryInput) =>
    runEntry(i).catch((error) => {
      log.error("hook command failed", { event: i.event, error })
      return { ran: false } as RunResult
    })

  if (entriesFor("tool.execute.before").length > 0) {
    result["tool.execute.before"] = async (i, o) => {
      for (const entry of entriesFor("tool.execute.before")) {
        const r = await safeRun({
          entry,
          event: "tool.execute.before",
          payload: { tool: i.tool, sessionID: i.sessionID, callID: i.callID, args: o.args },
          toolName: i.tool,
          cwd,
          exec,
        })
        // A hook may rewrite the tool args by emitting { "args": { ... } }.
        if (r.json && r.json.args && typeof r.json.args === "object") o.args = r.json.args
      }
    }
  }

  if (entriesFor("tool.execute.after").length > 0) {
    result["tool.execute.after"] = async (i, o) => {
      for (const entry of entriesFor("tool.execute.after")) {
        const r = await safeRun({
          entry,
          event: "tool.execute.after",
          payload: { tool: i.tool, sessionID: i.sessionID, callID: i.callID, args: i.args, output: o.output },
          toolName: i.tool,
          cwd,
          exec,
        })
        // A hook may override the title/output by emitting them on stdout.
        if (r.json && typeof r.json.title === "string") o.title = r.json.title
        if (r.json && typeof r.json.output === "string") o.output = r.json.output
      }
    }
  }

  if (entriesFor("chat.message").length > 0) {
    result["chat.message"] = async (i, o) => {
      for (const entry of entriesFor("chat.message")) {
        await safeRun({
          entry,
          event: "chat.message",
          payload: { sessionID: i.sessionID, agent: i.agent, message: o.message },
          cwd,
          exec,
        })
      }
    }
  }

  // session.start / session.idle arrive over the read-only event hook.
  if (entriesFor("session.start").length > 0 || entriesFor("session.idle").length > 0) {
    const eventToConfig: Record<string, ConfigHook.Event> = {
      "session.created": "session.start",
      "session.idle": "session.idle",
    }
    result.event = async ({ event }) => {
      const mapped = eventToConfig[event.type]
      if (!mapped) return
      for (const entry of entriesFor(mapped)) {
        await safeRun({
          entry,
          event: mapped,
          payload: { type: event.type, properties: (event as any).properties },
          cwd,
          exec,
        })
      }
    }
  }

  return result
}
