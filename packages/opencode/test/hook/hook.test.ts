import { describe, expect, test } from "bun:test"
import { Hook } from "../../src/hook"
import type { ConfigHook } from "../../src/config/hook"

// A fake executor that records every invocation and returns scripted output.
function fakeExec(responses: Array<{ exitCode?: number; stdout?: string; stderr?: string }> = []) {
  const calls: Hook.ExecInput[] = []
  let index = 0
  const exec: Hook.Exec = async (input) => {
    calls.push(input)
    const response = responses[index] ?? {}
    index++
    return {
      exitCode: response.exitCode ?? 0,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    }
  }
  return { exec, calls }
}

describe("Hook.matches", () => {
  test("undefined or empty matcher matches everything", () => {
    expect(Hook.matches(undefined, "bash")).toBe(true)
    expect(Hook.matches("", "bash")).toBe(true)
  })

  test("regex matchers are honored", () => {
    expect(Hook.matches("edit|write", "edit")).toBe(true)
    expect(Hook.matches("edit|write", "write")).toBe(true)
    expect(Hook.matches("edit|write", "bash")).toBe(false)
    expect(Hook.matches("^read$", "read")).toBe(true)
    expect(Hook.matches("^read$", "readonly")).toBe(false)
  })

  test("an invalid regex falls back to exact match", () => {
    expect(Hook.matches("[", "[")).toBe(true)
    expect(Hook.matches("[", "other")).toBe(false)
  })
})

describe("Hook.runEntry", () => {
  test("runs the command and passes payload as JSON on stdin", async () => {
    const { exec, calls } = fakeExec()
    const result = await Hook.runEntry({
      entry: { command: ["./hook.sh"] },
      event: "tool.execute.after",
      payload: { tool: "bash", sessionID: "ses_123" },
      toolName: "bash",
      cwd: "/work",
      exec,
    })

    expect(result.ran).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toEqual(["./hook.sh"])
    expect(calls[0].cwd).toBe("/work")
    expect(JSON.parse(calls[0].stdin)).toEqual({ tool: "bash", sessionID: "ses_123" })
    expect(calls[0].env.OPENCODE_HOOK_EVENT).toBe("tool.execute.after")
    expect(calls[0].env.OPENCODE_TOOL).toBe("bash")
    expect(calls[0].env.OPENCODE_SESSION_ID).toBe("ses_123")
  })

  test("skips execution when the matcher does not match the tool", async () => {
    const { exec, calls } = fakeExec()
    const result = await Hook.runEntry({
      entry: { command: "echo hi", matcher: "edit" },
      event: "tool.execute.before",
      payload: {},
      toolName: "bash",
      cwd: "/work",
      exec,
    })
    expect(result.ran).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test("parses a JSON object emitted on stdout", async () => {
    const { exec } = fakeExec([{ stdout: '{"args":{"path":"/safe"}}' }])
    const result = await Hook.runEntry({
      entry: { command: "x" },
      event: "tool.execute.before",
      payload: {},
      toolName: "bash",
      cwd: "/work",
      exec,
    })
    expect(result.json).toEqual({ args: { path: "/safe" } })
  })

  test("ignores non-JSON stdout", async () => {
    const { exec } = fakeExec([{ stdout: "just a log line" }])
    const result = await Hook.runEntry({
      entry: { command: "x" },
      event: "session.idle",
      payload: {},
      cwd: "/work",
      exec,
    })
    expect(result.json).toBeUndefined()
  })

  test("merges extra environment variables", async () => {
    const { exec, calls } = fakeExec()
    await Hook.runEntry({
      entry: { command: "x", environment: { FOO: "bar" } },
      event: "session.start",
      payload: {},
      cwd: "/work",
      exec,
    })
    expect(calls[0].env.FOO).toBe("bar")
  })
})

describe("Hook.fromConfig", () => {
  test("dispatches tool.execute.before and applies args rewrites", async () => {
    const { exec, calls } = fakeExec([{ stdout: '{"args":{"command":"rewritten"}}' }])
    const config: ConfigHook.Info = {
      "tool.execute.before": [{ command: "./pre.sh" }],
    }
    const hooks = Hook.fromConfig({ hooks: config, cwd: "/work", exec })

    const output = { args: { command: "original" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "ses_1", callID: "c1" } as any, output as any)

    expect(calls).toHaveLength(1)
    expect(output.args).toEqual({ command: "rewritten" })
  })

  test("filters tool hooks by matcher", async () => {
    const { exec, calls } = fakeExec()
    const config: ConfigHook.Info = {
      "tool.execute.after": [{ command: "./fmt.sh", matcher: "edit|write" }],
    }
    const hooks = Hook.fromConfig({ hooks: config, cwd: "/work", exec })

    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s", callID: "c", args: {} } as any,
      {
        title: "t",
        output: "o",
        metadata: {},
      } as any,
    )
    expect(calls).toHaveLength(0)

    await hooks["tool.execute.after"]!(
      { tool: "edit", sessionID: "s", callID: "c", args: {} } as any,
      {
        title: "t",
        output: "o",
        metadata: {},
      } as any,
    )
    expect(calls).toHaveLength(1)
  })

  test("tool.execute.after can override output", async () => {
    const { exec } = fakeExec([{ stdout: '{"output":"formatted"}' }])
    const config: ConfigHook.Info = { "tool.execute.after": [{ command: "x" }] }
    const hooks = Hook.fromConfig({ hooks: config, cwd: "/work", exec })

    const output = { title: "t", output: "raw", metadata: {} }
    await hooks["tool.execute.after"]!({ tool: "edit", sessionID: "s", callID: "c", args: {} } as any, output as any)
    expect(output.output).toBe("formatted")
  })

  test("maps session.created and session.idle events", async () => {
    const { exec, calls } = fakeExec()
    const config: ConfigHook.Info = {
      "session.start": [{ command: "./start.sh" }],
      "session.idle": [{ command: "./idle.sh" }],
    }
    const hooks = Hook.fromConfig({ hooks: config, cwd: "/work", exec })

    await hooks.event!({ event: { type: "session.created", properties: { foo: 1 } } as any })
    await hooks.event!({ event: { type: "session.idle", properties: {} } as any })
    // An unrelated event should not trigger anything.
    await hooks.event!({ event: { type: "message.updated", properties: {} } as any })

    expect(calls).toHaveLength(2)
    expect(calls[0].env.OPENCODE_HOOK_EVENT).toBe("session.start")
    expect(calls[1].env.OPENCODE_HOOK_EVENT).toBe("session.idle")
  })

  test("does not register handlers for events with no entries", () => {
    const hooks = Hook.fromConfig({ hooks: {}, cwd: "/work", exec: fakeExec().exec })
    expect(hooks["tool.execute.before"]).toBeUndefined()
    expect(hooks["tool.execute.after"]).toBeUndefined()
    expect(hooks["chat.message"]).toBeUndefined()
    expect(hooks.event).toBeUndefined()
  })

  test("a failing hook command does not throw", async () => {
    const exec: Hook.Exec = async () => {
      throw new Error("spawn failed")
    }
    const config: ConfigHook.Info = { "tool.execute.before": [{ command: "x" }] }
    const hooks = Hook.fromConfig({ hooks: config, cwd: "/work", exec })

    const output = { args: { a: 1 } }
    // Should resolve without throwing, leaving args untouched.
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s", callID: "c" } as any, output as any)
    expect(output.args).toEqual({ a: 1 })
  })
})
