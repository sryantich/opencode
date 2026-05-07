import path from "path"
import { existsSync, statSync } from "fs"
import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

export const ChangeDirectoryTool = Tool.define("change_directory", {
  description: [
    "Switch the working directory for this session to a different folder.",
    "Use this only when the user has explicitly asked to work in a different directory or project.",
    "The user (or their permission policy) must approve the switch before it takes effect.",
    "After switching, all subsequent file operations, shell commands, LSP, and search tools",
    "operate against the new directory. The full history of directory changes is preserved",
    "for this session and surfaced in the system prompt so you can recover orphaned files.",
  ].join(" "),
  parameters: z.object({
    directory: z.string().describe("Absolute or relative path to switch the working directory to."),
    reason: z
      .string()
      .optional()
      .describe("Short explanation of why you are switching directories. Surfaced to the user."),
  }),
  async execute(params, ctx) {
    const target = Filesystem.resolve(params.directory)
    if (!existsSync(target)) {
      throw new Error(`Directory does not exist: ${target}`)
    }
    if (!statSync(target).isDirectory()) {
      throw new Error(`Path is not a directory: ${target}`)
    }

    const glob = path.join(target, "**").replaceAll("\\", "/")
    await ctx.ask({
      permission: "project.directory_switch",
      patterns: [glob],
      always: [glob],
      metadata: {
        directory: target,
        reason: params.reason,
        from: Instance.directory,
      },
    })

    const result = await Session.changeDirectory({
      sessionID: ctx.sessionID,
      directory: target,
      actor: "agent",
      reason: params.reason,
    })

    // Swap the live Instance so subsequent tool calls in this turn see the new
    // directory (LSP, watchers, MCP, plugins, formatters all rebuild).
    await Instance.switchDirectory(target)

    return {
      title: `Switched directory to ${target}`,
      output: [
        `Working directory is now ${target}.`,
        `Project: ${result.project.id}`,
        `Worktree: ${result.project.worktree}`,
        result.history ? `Recorded as history entry ${result.history.id}.` : `No-op (already at this directory).`,
      ].join("\n"),
      metadata: {
        directory: target,
        projectID: result.project.id,
        worktree: result.project.worktree,
        historyID: result.history?.id,
      },
    }
  },
})
