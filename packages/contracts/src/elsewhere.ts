import { Schema } from 'effect'

/*
 * What other tools left for a project's repositories on this computer, and
 * what of it a project brings in (docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"): worktrees, as tasks in place; their
 * setup, as a repository's; and Claude Code's and Codex's conversations,
 * each as the history of the task its worktree became, else an aside.
 */

/** Another tool: one that makes worktrees, an agent whose conversations are here, or the person's own hand. */
export const OtherTool = Schema.Literals(['conductor', 'orca', 't_three_code', 'paradev', 'cursor', 'codex', 'claude_code', 'hand'])
export type OtherTool = typeof OtherTool.Type

/** An agent whose conversations a project brings in. */
export const ConversationAgent = Schema.Literals(['claude_code', 'codex'])
export type ConversationAgent = typeof ConversationAgent.Type

const PullRequestLink = Schema.Struct({ number: Schema.Number, url: Schema.String })

export const ElsewhereWorktree = Schema.Struct({
  /** How it is named when it is picked, and once it is brought in. */
  key: Schema.String,
  tool: OtherTool,
  repositoryId: Schema.String,
  repository: Schema.String,
  path: Schema.String,
  /** Null where it is detached: it comes in as a quick task, whose branch is made where its lead first writes. */
  branch: Schema.NullOr(Schema.String),
  /** What its tool calls it, else its folder's name. */
  name: Schema.String,
  uncommitted: Schema.Number,
  unpushed: Schema.NullOr(Schema.Number),
  /** Commits its default branch doesn't have. */
  ahead: Schema.NullOr(Schema.Number),
  pullRequest: Schema.NullOr(PullRequestLink),
  /** Its tool archived it, its folder still there. */
  archived: Schema.Boolean,
  lastAt: Schema.NullOr(Schema.String),
  /** Its conversations found, by their keys: they come in with it. */
  conversations: Schema.Array(Schema.String),
  /** The task it became, where it was brought in already. */
  taskId: Schema.NullOr(Schema.String),
})
export type ElsewhereWorktree = typeof ElsewhereWorktree.Type

export const ElsewhereSetup = Schema.Struct({
  key: Schema.String,
  tool: OtherTool,
  repositoryId: Schema.String,
  repository: Schema.String,
  /** The file in the repository it was read from. */
  file: Schema.String,
  /** What Althar would run, in order, in each new worktree. */
  commands: Schema.Array(Schema.String),
  /** The files it would copy in from the checkout. */
  copy: Schema.Array(Schema.String),
  /** It is the repository's setup already. */
  current: Schema.Boolean,
})
export type ElsewhereSetup = typeof ElsewhereSetup.Type

export const ElsewhereConversation = Schema.Struct({
  key: Schema.String,
  agent: ConversationAgent,
  title: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  lastAt: Schema.NullOr(Schema.String),
  /** How often the person wrote; null where only listed, as a long one is. */
  prompts: Schema.NullOr(Schema.Number),
  /** The worktree it ran in, by its key; null for one in the repository's checkout, which comes in as an aside. */
  worktree: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
})
export type ElsewhereConversation = typeof ElsewhereConversation.Type

export const Elsewhere = Schema.Struct({
  worktrees: Schema.Array(ElsewhereWorktree),
  setups: Schema.Array(ElsewhereSetup),
  conversations: Schema.Array(ElsewhereConversation),
})
export type Elsewhere = typeof Elsewhere.Type

/** What of what the person picked came in, and, for each that didn't, why, in a line. */
export const BroughtIn = Schema.Struct({
  tasks: Schema.Array(Schema.String),
  asides: Schema.Array(Schema.String),
  setups: Schema.Number,
  /** Conversations that came in as the history of a task, its own or one brought in before. */
  histories: Schema.Number,
  failed: Schema.Array(Schema.Struct({ key: Schema.String, why: Schema.String })),
})
export type BroughtIn = typeof BroughtIn.Type
