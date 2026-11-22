import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/*
 * ADR-097: permissive by default. A command inside an OS sandbox is answered
 * at once from these rules; only secrets, the person's own rules and a visible
 * irreversible act hold it, and an opaque one runs. Outside it, Allow
 * everything asks only about visible irreversible actions. Opaque commands
 * are not denied for what the rules cannot infer. Git's guard still holds
 * hidden irreversible pushes and branch moves.
 *
 * The coordinator uses these same rules, with visible outside-folder writes
 * refused where no sandbox holds them. The strict reader below is reserved
 * for reviews, whose workspaces and tool lists are deferred to task-as-parts.
 */

export type Verdict =
  /** Allowed: by the project's allow rules where `rules` names them (ADR-018), else because nothing keeps it. */
  | { readonly verdict: 'allow'; readonly rules?: ReadonlyArray<AllowRule> }
  /**
   * It waits for the person: `held` where a kind on the always-ask list, or
   * a command the project asks about, keeps it for them, which no rule or
   * judge answers; otherwise because the rules can't tell what it does, or
   * the project asks about everything.
   */
  | { readonly verdict: 'ask'; readonly reason: string; readonly held: boolean }
  /** The coordinator judges it (ADR-019): what no rule answers, in a project that has the coordinator decide. */
  | { readonly verdict: 'judge'; readonly reason: string }
  | { readonly verdict: 'deny'; readonly reason: string }

/**
 * The kinds of request the rules keep for the person (ADR-013): each one a
 * project can have ask, refuse, or let through. Where the rules can't tell
 * what a request does, it asks whatever the project says, short of
 * allowing everything.
 */
export const RULES = ['default-branch', 'force-push', 'many-branches', 'delete-branch', 'deploy', 'outside', 'speak'] as const

export type RuleId = (typeof RULES)[number]

/** What each kind is, in the words a refusal says it. */
export const RULE_WORDS: Readonly<Record<RuleId, string>> = {
  'default-branch': 'pushing to the default branch',
  'force-push': 'force pushes',
  'many-branches': 'pushing every branch, tags, or a pattern of branches',
  'delete-branch': "deleting branches that aren't the task's",
  deploy: 'deploying and publishing',
  outside: "writing outside the task's worktree",
  speak: 'posting for you on a pull request, an issue or another service',
}

/**
 * Why the rules keep a request for the person, and which kind it is: one a
 * project names, or one they can't tell. Only `irreversible` creates a
 * built-in floor. Historical `floor` classifications remain ordinary kinds
 * for the person's own Never and Ask lists; they create no extra ask.
 *
 * `irreversible` marks what can't be undone from the task (ADR-067): a force
 * push, a push to or a deletion of the default branch, deleting or moving by
 * force a branch that isn't the task's, git discarding work in another
 * checkout, deleting or moving away what's outside the task's worktree,
 * changing another checkout, and a push the rules can't read. It asks the
 * person even with everything allowed, where the rules read it as one of
 * those (`lastingOf`): what they can't tell goes ahead there.
 */
export interface Kept {
  readonly reason: string
  readonly rule: RuleId | 'unclear'
  readonly floor?: boolean
  readonly irreversible?: boolean
  /** Found only reading it from a folder the rules can't tell, as the worst it could be: `cd "$DIR" && git reset --hard`. */
  readonly blind?: boolean
}

/** How firmly a kind is kept: `floor` past the coordinator, `irreversible` past allowing everything too. */
export type Floor = 'floor' | 'irreversible'

export const kept = (reason: string, rule: RuleId | 'unclear', floor?: Floor): Kept =>
  floor === undefined ? { reason, rule } : floor === 'floor' ? { reason, rule } : { reason, rule, floor: true, irreversible: true }

/** The firmest of what kinds are kept: what a request standing for them all is. */
export const floorOf = (kinds: ReadonlyArray<Kept>): Floor | undefined =>
  kinds.some((each) => each.irreversible === true) ? 'irreversible' : kinds.some((each) => each.floor === true) ? 'floor' : undefined

/**
 * A command the person named (ADR-013, ADR-018): asked about, refused, or
 * let through. By how it starts (`npm publish`, `terraform *`), or, where
 * `match` says so, as this exact line.
 */
export interface CommandRule {
  readonly pattern: string
  readonly decision: 'ask' | 'never' | 'allow'
  readonly match?: 'prefix' | 'exact' | undefined
}

/** What let a request through without asking (ADR-018): a kind the project always allows, or a command rule. */
export type AllowRule = { readonly kind: RuleId } | { readonly pattern: string; readonly match: 'prefix' | 'exact' }

/** A project's rules, as the rules read them (ADR-013, ADR-018, Policies). */
export interface ProjectRuleSet {
  /** Read-only web commands may go through, even when the rest asks. */
  readonly web?: boolean
  /**
   * What happens to what no rule keeps: it is allowed (`rules`), it waits
   * for the person (`ask`), or the coordinator judges (`coordinator`);
   * or everything is allowed (`allow`), the
   * always-ask list with it, and only what is never allowed is refused.
   */
  readonly mode: 'rules' | 'coordinator' | 'ask' | 'allow'
  /** The kinds that ask the person. */
  readonly ask: ReadonlyArray<RuleId>
  /** The kinds refused outright, whoever would answer. */
  readonly never: ReadonlyArray<RuleId>
  /** The kinds let through without asking, short of what always asks or is never allowed. */
  readonly allow: ReadonlyArray<RuleId>
  /** Commands the person named: asked about, refused, or let through. */
  readonly commands: ReadonlyArray<CommandRule>
}

export const exactly = (rule: CommandRule) => rule.match === 'exact'

/** A command rule as it reads in a sentence. */
const commandWords = (rule: CommandRule) => (exactly(rule) ? `exactly \`${rule.pattern}\`` : `commands starting \`${rule.pattern}\``)

/** An allow rule as it reads in a sentence: a kind's words, or a command rule's. */
export const sayAllowRule = (rule: AllowRule): string =>
  'kind' in rule ? RULE_WORDS[rule.kind] : commandWords({ pattern: rule.pattern, decision: 'allow', match: rule.match })

/** A project's rules in a few sentences, for an agent that plans work under them. */
export const sayRules = (rules: ProjectRuleSet): string => {
  const named = (decision: CommandRule['decision']) =>
    rules.commands.flatMap((command) => (command.decision === decision ? [commandWords(command)] : []))
  const asks = [...rules.ask.map((id) => RULE_WORDS[id]), ...named('ask')]
  const never = [...rules.never.map((id) => RULE_WORDS[id]), ...named('never')]
  const allowed = [...rules.allow.map((id) => RULE_WORDS[id]), ...named('allow')]
  return [
    rules.mode === 'coordinator'
      ? `The coordinator judges permission requests within these rules. Always ask the person: ${asks.length === 0 ? 'none' : asks.join('; ')}.`
      : rules.mode === 'ask'
        ? "Agents may read anything and change a task's own files; everything else waits for the person."
        : rules.mode === 'allow'
          ? `Agents may do anything but what can't be undone, which waits for the person: losing work or history (a force push, a push to the default branch, deleting another branch), publishing, a release or a merge, and posting for the person${named('ask').length === 0 ? '' : `; and before running ${named('ask').join('; ')}`}.`
          : asks.length === 0
            ? 'Agents may do anything.'
            : `Agents may do anything but these, which wait for the person: ${asks.join('; ')}.`,
    ...(rules.mode === 'allow' || allowed.length === 0 ? [] : [`Allowed without asking: ${allowed.join('; ')}.`]),
    ...(never.length === 0 ? [] : [`Never allowed: ${never.join('; ')}.`]),
  ].join(' ')
}

/** The MVP's rules, a project's first: everything allowed but every kind above, which asks. */
export const MVP_RULES: ProjectRuleSet = { mode: 'rules', ask: RULES, never: [], allow: [], commands: [] }

export interface RuleContext {
  /** Where the agent works: the task's worktree, a folder in it, or the task's folder that holds its worktrees. */
  readonly worktree: string
  /** Coordinator commands may visibly write only within this folder; opaque commands run. */
  readonly readOnly?: boolean
  /** The task's worktrees, one per repository, where it may write; just `worktree` unless the task has several. */
  readonly worktrees?: ReadonlyArray<string>
  /**
   * Those of `worktrees` that are the person's own checkouts, as a Local
   * task's are (ADR-091): git there that would throw away what isn't
   * committed always asks, as in another checkout, since some of it may be
   * the person's.
   */
  readonly shared?: ReadonlyArray<string>
  /** The branch pushes to which always ask. */
  readonly defaultBranch: string
  /** Every repository's default branch, where the task has several repositories. */
  readonly defaultBranches?: ReadonlyArray<string>
  /** The task's branch, which the agent may push to and delete. */
  readonly taskBranch?: string
  /** The branch checked out in the worktree now, where a push without a destination goes. */
  readonly currentBranch?: string
  /** Follows symlinks; the file system's own unless a test gives one. */
  readonly realPath?: (path: string) => string
  /** Folders anything may write to, such as the temp folder. */
  readonly scratch?: ReadonlyArray<string>
  /**
   * The folder `$TMPDIR`, `$TMP` and `$TEMP` name in the agent's commands,
   * where Althar knows it: its own, as its launch made it (`privateTemp`).
   * Other agents name a temp folder of their own choosing.
   */
  readonly temp?: string
  /** The system the agent works on, whose paths and commands it names: this computer's unless a test gives one. */
  readonly platform?: NodeJS.Platform
  /** The person's home folder: this computer's unless a test gives one. */
  readonly home?: string
  /** The project's rules; the MVP's without them. */
  readonly project?: ProjectRuleSet
  /**
   * Whether the agent's git runs Althar's guard (pushGuard.ts), which stops a
   * push to the default branch, a force push and deleting another branch
   * whatever runs it: a project that never allows only these needn't refuse
   * what the rules can't read.
   */
  readonly guarded?: boolean
  /**
   * The folder the agent's shell is in now, where its own record says (a
   * Claude Code session's transcript): a line is read from there, not from
   * the worktree's top, which is only a guess where the shell may be.
   */
  readonly shell?: string
  /** A repository's stash entries' messages, `stash@{0}` first: git's own record unless a test gives one. */
  readonly stashes?: (folder: string) => ReadonlyArray<string>
}

/** How the system an agent works on reads a path: its path functions, and the person's home folder. */
export interface System {
  readonly paths: typeof posix
  readonly home: string
  readonly windows: boolean
  /** Its files' names are the same in any case, as on Windows and macOS: `~/.SSH` is `~/.ssh`. */
  readonly caseless: boolean
}

export const systemOf = (context: Pick<RuleContext, 'platform' | 'home'> = {}): System => {
  const platform = context.platform ?? process.platform
  const windows = platform === 'win32'
  return { paths: windows ? win32 : posix, home: context.home ?? homedir(), windows, caseless: windows || platform === 'darwin' }
}

export const ALLOW = { verdict: 'allow' } as const satisfies Verdict

export const ask = (reason: string, held: boolean): Verdict => ({ verdict: 'ask', reason, held })
