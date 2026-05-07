import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.changeDirectory", () => {
  test("records history and updates session.directory for same-project swap", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cd-"))

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const result = await Session.changeDirectory({
          sessionID: session.id,
          directory: target,
          actor: "user",
          reason: "test reason",
        })

        expect(result.session.directory).toBe(path.resolve(target))
        expect(result.history?.actor).toBe("user")
        expect(result.history?.reason).toBe("test reason")
        expect(result.history?.from?.directory).toBe(session.directory)
        expect(result.history?.to.directory).toBe(path.resolve(target))

        const history = await Session.directoryHistory(session.id)
        expect(history).toHaveLength(1)
        expect(history[0]!.to.directory).toBe(path.resolve(target))

        const fetched = await Session.get(session.id)
        expect(fetched.directory).toBe(path.resolve(target))

        await Session.remove(session.id)
      },
    })

    await fs.rm(target, { recursive: true, force: true })
  })

  test("noop when target equals current directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const result = await Session.changeDirectory({
          sessionID: session.id,
          directory: session.directory,
          actor: "user",
        })

        expect(result.history).toBeUndefined()

        const history = await Session.directoryHistory(session.id)
        expect(history).toHaveLength(0)

        await Session.remove(session.id)
      },
    })
  })

  test("emits session.directory_changed bus event", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cd-"))

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { Bus } = await import("../../src/bus")
        const events: any[] = []
        const unsub = Bus.subscribe(Session.Event.DirectoryChanged, (event) => {
          events.push(event.properties)
        })

        const session = await Session.create({})
        await Session.changeDirectory({
          sessionID: session.id,
          directory: target,
          actor: "agent",
        })

        await new Promise((r) => setTimeout(r, 50))
        unsub()

        expect(events.length).toBeGreaterThanOrEqual(1)
        const last = events[events.length - 1]
        expect(last.sessionID).toBe(session.id)
        expect(last.to.directory).toBe(path.resolve(target))
        expect(last.actor).toBe("agent")

        await Session.remove(session.id)
      },
    })

    await fs.rm(target, { recursive: true, force: true })
  })
})
