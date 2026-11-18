import type { Elsewhere, ElsewhereConversation, ElsewhereSetup, ElsewhereWorktree, OtherTool } from '@althar/contracts'
import { Brand, Icon, type OtherToolItem, type OtherToolTile } from '@althar/ui'

import { shortFolder } from '../../shared/folders'
import { ago } from '../../shared/time'

/*
 * What other tools left for a project, as the kit's tiles show it (docs/decisions/workspaces-and-runs.md, "Bringing in
 * other tools' work"): a tile for each tool, in the order people move from them, with its worktrees, its setup and, for
 * an agent, its conversations. What came in already isn't offered again.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const words = {
  heading: 'Already under way',
  line: 'What other tools left in its folders. Nothing there changes.',
  /** A new project's foot: what making it brings in too. */
  andThen: (go: string) => `Then ${go.charAt(0).toLowerCase()}${go.slice(1)}.`,
  names: {
    conductor: 'Conductor',
    orca: 'Orca',
    t_three_code: 'T3 Code',
    paradev: 'Paradev',
    cursor: 'Cursor',
    codex: 'Codex',
    claude_code: 'Claude Code',
    hand: 'By hand',
  } satisfies Record<OtherTool, string>,
  worktrees: 'Worktrees',
  setup: 'Setup',
  conversations: 'Conversations',
  worktreeCount: (n: number) => plural(n, 'worktree'),
  conversationCount: (n: number) => plural(n, 'conversation'),
  uncommitted: (n: number) => `${plural(n, 'file')} not committed`,
  unpushed: (n: number) => `${n} not pushed`,
  detached: 'detached',
  archived: 'Archived there',
  setupOf: (tool: string) => `${tool}’s setup`,
  prompts: (n: number) => plural(n, 'prompt'),
  ranIn: (name: string) => `in ${name}`,
  last: (when: string) => `Last worked on ${when}`,
  /** What the main button brings in, counted. */
  bring: (worktrees: number, setups: number, conversations: number) => {
    const parts = [
      worktrees === 0 ? null : plural(worktrees, 'worktree'),
      setups === 0 ? null : plural(setups, 'setup'),
      conversations === 0 ? null : plural(conversations, 'conversation'),
    ].filter((one) => one !== null)
    if (parts.length === 0) return null
    const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    return `Bring in ${said}`
  },
}

const BRANDS: Partial<Record<OtherTool, Brand>> = {
  conductor: Brand.Conductor,
  orca: Brand.Orca,
  t_three_code: Brand.T3Code,
  paradev: Brand.Paradev,
  cursor: Brand.Cursor,
  codex: Brand.Codex,
  claude_code: Brand.ClaudeCode,
}

/** The tools in the order the tiles go: those that make worktrees, then the agents, then the person's own. */
const ORDER: ReadonlyArray<OtherTool> = ['conductor', 'orca', 't_three_code', 'paradev', 'cursor', 'claude_code', 'codex', 'hand']

const worktreeFacts = (one: ElsewhereWorktree) =>
  [
    one.pullRequest === null ? null : (
      <>
        <Icon name="pr" size={12} />#{one.pullRequest.number}
      </>
    ),
    one.uncommitted > 0 ? words.uncommitted(one.uncommitted) : null,
    one.unpushed !== null && one.unpushed > 0 ? (
      <>
        <Icon name="up" size={12} />
        {words.unpushed(one.unpushed)}
      </>
    ) : null,
    one.archived ? words.archived : null,
  ].filter((fact) => fact !== null)

const worktreeItem = (one: ElsewhereWorktree, now: Date): OtherToolItem => ({
  key: one.key,
  title: one.name,
  ...(one.lastAt === null ? {} : { at: ago(one.lastAt, now) }),
  where: (
    <>
      <code>{one.branch ?? words.detached}</code>
      <code title={one.path}>{shortFolder(one.path)}</code>
    </>
  ),
  facts: worktreeFacts(one),
})

const setupItem = (one: ElsewhereSetup, many: boolean): OtherToolItem => ({
  key: one.key,
  title: words.setupOf(words.names[one.tool]),
  where: <code>{many ? `${one.repository}/${one.file}` : one.file}</code>,
  facts: [one.commands.at(-1)?.split('\n').at(-1) ?? ''],
})

const conversationItem = (one: ElsewhereConversation, worktrees: ReadonlyArray<ElsewhereWorktree>, now: Date): OtherToolItem => {
  const ran = one.worktree === null ? undefined : worktrees.find((worktree) => worktree.key === one.worktree)
  const at = one.lastAt ?? one.startedAt
  return {
    key: one.key,
    title: one.title,
    brand: one.agent === 'codex' ? Brand.Codex : Brand.ClaudeCode,
    ...(at === null ? {} : { at: ago(at, now) }),
    where: [one.prompts === null ? null : words.prompts(one.prompts), ran === undefined ? null : words.ranIn(ran.name)]
      .filter(Boolean)
      .join(' · '),
  }
}

/** The tiles for what was found, what came in already left out. */
export const tilesOf = (found: Elsewhere, now: Date = new Date()): ReadonlyArray<OtherToolTile> => {
  const worktrees = found.worktrees.filter((one) => one.taskId === null)
  const setups = found.setups.filter((one) => !one.current)
  const conversations = found.conversations.filter((one) => one.taskId === null)
  const repositories = new Set([...found.worktrees, ...found.setups].map((one) => one.repositoryId)).size
  return ORDER.flatMap((tool): ReadonlyArray<OtherToolTile> => {
    const made = worktrees.filter((one) => one.tool === tool).toSorted((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
    const kept = setups.filter((one) => one.tool === tool)
    const said = tool === 'claude_code' || tool === 'codex' ? conversations.filter((one) => one.agent === tool) : []
    if (made.length + kept.length + said.length === 0) return []
    const size = [
      made.length === 0 ? null : words.worktreeCount(made.length),
      said.length === 0 ? null : words.conversationCount(said.length),
    ].filter(Boolean)
    // Its most pressing fact: a worktree's work not committed or not pushed, its pull request, else when it was last used.
    const pressing = made.map((one) => worktreeFacts(one)[0]).find((fact) => fact !== undefined)
    const latest = [...made.map((one) => one.lastAt), ...said.map((one) => one.lastAt ?? one.startedAt)]
      .filter((at) => at !== null)
      .toSorted()
      .at(-1)
    const brand = BRANDS[tool]
    return [
      {
        id: tool,
        name: words.names[tool],
        ...(brand === undefined ? { icon: 'branch' as const } : { brand }),
        size: size.length === 0 ? words.setupOf(words.names[tool]) : size.join(' · '),
        ...(pressing !== undefined ? { fact: pressing } : latest === undefined ? {} : { fact: words.last(ago(latest, now)) }),
        groups: [
          { title: words.worktrees, items: made.map((one) => worktreeItem(one, now)) },
          { title: words.setup, items: kept.map((one) => setupItem(one, repositories > 1)) },
          {
            title: words.conversations,
            items: said
              .toSorted((a, b) => (b.lastAt ?? b.startedAt ?? '').localeCompare(a.lastAt ?? a.startedAt ?? ''))
              .map((one) => conversationItem(one, found.worktrees, now)),
          },
        ],
      },
    ]
  })
}

/**
 * Picks, as the tiles change them: a repository takes one setup, so picking one leaves another tool's for the same
 * repository. What isn't offered any more is let go.
 */
export const picked = (found: Elsewhere, now: ReadonlySet<string>, keys: ReadonlyArray<string>, on: boolean): ReadonlySet<string> => {
  const next = new Set(now)
  for (const key of keys) {
    if (!on) {
      next.delete(key)
      continue
    }
    next.add(key)
    const setup = found.setups.find((one) => one.key === key)
    if (setup !== undefined)
      for (const other of found.setups) if (other.key !== key && other.repositoryId === setup.repositoryId) next.delete(other.key)
  }
  return next
}

/** What the picks are, by kind, as BringIn takes them. */
export const picksOf = (found: Elsewhere, keys: ReadonlySet<string>) => ({
  worktrees: found.worktrees.filter((one) => keys.has(one.key)).map((one) => one.key),
  setups: found.setups.filter((one) => keys.has(one.key)).map((one) => one.key),
  conversations: found.conversations.filter((one) => keys.has(one.key)).map((one) => one.key),
})
