import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { existsSync, statSync } from "fs"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(directory: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function boot(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await Project.fromDirectory(input.directory).then(({ project, sandbox }) => ({
            directory: input.directory,
            worktree: sandbox,
            project,
          }))
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(directory: string, next: Promise<Context>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) cache.delete(directory)
    throw error
  })
  cache.set(directory, task)
  return task
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = track(
        directory,
        boot({
          directory,
          init: input.init,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    Log.Default.info("reloading instance", { directory })
    await State.dispose(directory)
    cache.delete(directory)
    const next = track(directory, boot({ ...input, directory }))
    emit(directory)
    return await next
  },
  /**
   * Validate a target path and switch the active Instance to it.
   * Disposes & rebuilds Instance.state slots (LSP, watchers, MCP, formatters,
   * tool registry, plugins, TUI config) so they retarget the new directory.
   * Emits "instance.directory_changed" via the bus.
   */
  async switchDirectory(directory: string) {
    const target = Filesystem.resolve(directory)
    if (!existsSync(target)) throw new Error(`Directory does not exist: ${target}`)
    const stat = statSync(target)
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${target}`)

    const previous = {
      directory: Instance.directory,
      worktree: Instance.worktree,
      project: Instance.project,
    }

    const { project, sandbox } = await Project.fromDirectory(target)
    await Instance.reload({ directory: target, project, worktree: sandbox })

    GlobalBus.emit("event", {
      directory: target,
      payload: {
        type: InstanceEvent.DirectoryChanged.type,
        properties: {
          from: {
            directory: previous.directory,
            worktree: previous.worktree,
            projectID: previous.project.id,
          },
          to: {
            directory: target,
            worktree: sandbox,
            projectID: project.id,
          },
        },
      },
    })

    return { project, worktree: sandbox, directory: target }
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    emit(Instance.directory)
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}

const DirectoryChangePayload = z.object({
  from: z.object({
    directory: z.string(),
    worktree: z.string(),
    projectID: z.string(),
  }),
  to: z.object({
    directory: z.string(),
    worktree: z.string(),
    projectID: z.string(),
  }),
})

export const InstanceEvent = {
  DirectoryChanged: BusEvent.define("instance.directory_changed", DirectoryChangePayload),
}
