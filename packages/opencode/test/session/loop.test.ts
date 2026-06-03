import { describe, expect, test } from "bun:test"
import { Loop } from "../../src/session/loop"

describe("Loop.decide", () => {
  test("stops when no loop config is present", () => {
    const decision = Loop.decide({ config: undefined, iteration: 0, lastText: "anything" })
    expect(decision).toEqual({ action: "stop", reason: "disabled" })
  })

  test("continues with the default prompt when enabled and under the cap", () => {
    const decision = Loop.decide({ config: {}, iteration: 0, lastText: "still working" })
    expect(decision).toEqual({ action: "continue", prompt: Loop.DEFAULT_PROMPT })
  })

  test("continues with a custom prompt when configured", () => {
    const decision = Loop.decide({ config: { prompt: "keep going" }, iteration: 1, lastText: "" })
    expect(decision).toEqual({ action: "continue", prompt: "keep going" })
  })

  test("stops once the default iteration cap is reached", () => {
    const decision = Loop.decide({
      config: {},
      iteration: Loop.DEFAULT_MAX_ITERATIONS,
      lastText: "not done",
    })
    expect(decision).toEqual({ action: "stop", reason: "max_iterations" })
  })

  test("respects a custom max_iterations cap", () => {
    expect(Loop.decide({ config: { max_iterations: 2 }, iteration: 1, lastText: "" }).action).toBe("continue")
    expect(Loop.decide({ config: { max_iterations: 2 }, iteration: 2, lastText: "" })).toEqual({
      action: "stop",
      reason: "max_iterations",
    })
  })

  test("stops when the completion marker appears in the last response", () => {
    const decision = Loop.decide({
      config: { until: "GOAL_COMPLETE" },
      iteration: 0,
      lastText: "All tasks done. GOAL_COMPLETE",
    })
    expect(decision).toEqual({ action: "stop", reason: "until" })
  })

  test("keeps going when the completion marker is absent", () => {
    const decision = Loop.decide({
      config: { until: "GOAL_COMPLETE" },
      iteration: 0,
      lastText: "still in progress",
    })
    expect(decision.action).toBe("continue")
  })

  test("max_iterations takes precedence over the marker check", () => {
    const decision = Loop.decide({
      config: { until: "DONE", max_iterations: 1 },
      iteration: 1,
      lastText: "no marker here",
    })
    expect(decision).toEqual({ action: "stop", reason: "max_iterations" })
  })

  test("an empty until string does not stop the loop", () => {
    const decision = Loop.decide({ config: { until: "" }, iteration: 0, lastText: "" })
    expect(decision.action).toBe("continue")
  })
})
