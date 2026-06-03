import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigHook } from "../../src/config/hook"
import { ConfigLoop } from "../../src/config/loop"

describe("ConfigHook.Info decoding", () => {
  const decode = Schema.decodeUnknownSync(ConfigHook.Info)

  test("decodes an empty object", () => {
    expect(decode({})).toEqual({})
  })

  test("decodes a string command", () => {
    const input = { "tool.execute.before": [{ command: "echo hi" }] }
    expect(decode(input)).toEqual(input)
  })

  test("decodes an argv command with matcher and environment", () => {
    const input = {
      "tool.execute.after": [
        { command: ["./format.sh"], matcher: "edit|write", environment: { CI: "1" }, timeout: 5000 },
      ],
    }
    expect(decode(input)).toEqual(input)
  })

  test("decodes session lifecycle hooks", () => {
    const input = {
      "session.start": [{ command: "./start.sh" }],
      "session.idle": [{ command: ["notify-send", "done"] }],
    }
    expect(decode(input)).toEqual(input)
  })

  test("drops unknown event keys", () => {
    expect(decode({ "not.an.event": [{ command: "x" }] })).toEqual({})
  })

  test("requires a command on each entry", () => {
    expect(() => decode({ "chat.message": [{ matcher: "x" }] })).toThrow()
  })
})

describe("ConfigLoop.Info decoding", () => {
  const decode = Schema.decodeUnknownSync(ConfigLoop.Info)

  test("decodes an empty object", () => {
    expect(decode({})).toEqual({})
  })

  test("decodes all fields", () => {
    const input = { max_iterations: 25, until: "GOAL_COMPLETE", prompt: "continue" }
    expect(decode(input)).toEqual(input)
  })

  test("rejects a non-numeric max_iterations", () => {
    expect(() => decode({ max_iterations: "lots" })).toThrow()
  })
})
