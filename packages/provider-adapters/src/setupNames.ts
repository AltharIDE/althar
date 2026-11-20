import { parse as parseToml } from 'smol-toml'

/*
 * What Althar needs to know of Claude Code and Codex to say a part of the person's own setup won't load where the agent
 * doesn't say so itself (docs/decisions/the-persons-setup.md, "When part of it doesn't load"): the tool names a hook
 * matcher can name, and whether Codex can read a `config.toml`.
 */

/**
 * Claude Code's built-in tools as hook matchers name them, from claude-agent-sdk 0.3.326 (Claude Code 2.1.326):
 * `BUILTIN_TOOL_NAMES`, the former names it still accepts (`LEGACY_TOOL_NAME_ALIASES`), and those its sessions list in
 * `system/init` that the export leaves out. The SDK says the list isn't complete, so a name not on it is only judged
 * when it is close to one that is.
 */
export const CLAUDE_TOOL_NAMES: ReadonlyArray<string> = [
  'Agent',
  'Artifact',
  'AskUserQuestion',
  'Bash',
  'ClaudeDesign',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EndConversation',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'ListAgents',
  'ListMcpResourcesTool',
  'LSP',
  'Monitor',
  'NotebookEdit',
  'OfferChromeSetup',
  'PowerShell',
  'Projects',
  'propose_skills',
  'PushNotification',
  'Read',
  'ReadMcpResourceDirTool',
  'ReadMcpResourceTool',
  'ReadNotifications',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendFeedback',
  'SendMessage',
  'SendUserFile',
  'SendUserMessage',
  'SetGoal',
  'ShareOnboardingGuide',
  'ShowOnboardingRolePicker',
  'Skill',
  'SubagentHandback',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'ToolSearch',
  'WaitForMcpServers',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
  // Former names.
  'Task',
  'KillShell',
  'KillBash',
  'ListPeers',
  'Brief',
  'ListMcpResources',
  'ReadMcpResource',
  'ReadMcpResourceDir',
  'ProposeGoal',
  // Listed by a session's `system/init`, not by the export.
  'DesignSync',
]

/** The hook events whose matcher names a tool, from claude-agent-sdk 0.3.326's `HOOK_EVENTS` and Claude Code's hooks docs. */
export const CLAUDE_TOOL_HOOK_EVENTS: ReadonlyArray<string> = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
]

/** Why a `config.toml` can't be read, in the parser's words; undefined where it can. */
export const tomlProblem = (text: string): string | undefined => {
  try {
    parseToml(text)
    return undefined
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    // smol-toml puts the line in question and a caret under it after its first line.
    return said.split('\n')[0]?.trim() || 'It can’t be read.'
  }
}
