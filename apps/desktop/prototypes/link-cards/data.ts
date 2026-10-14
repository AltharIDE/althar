// Scrappy: what the threads hold: the person's message with its links, unfurled as the runtime unfurls them, between two of the agent's turns.
import type { ThreadItem, Unfurl } from '@althar/contracts'

import { items } from '../../tests/fixtures'
import type { Scenario } from './state'

const LINEAR = 'https://linear.app/althar/issue/DEV-68/run-the-agent-adapters-on-their-own-node-and-turn-the-runasnode-fuse-off'
const PR = 'https://github.com/AltharIDE/althar/pull/131'

/** DEV-68, as Linear's unfurl gives it. */
export const DEV68: Unfurl = {
  kind: 'issue',
  product: 'linear',
  key: 'DEV-68',
  title: 'Run the agent adapters on their own Node, and turn the runAsNode fuse off',
  url: LINEAR,
  status: { name: 'Todo', category: 'todo' },
  priority: { level: 'high', name: 'High' },
  container: 'Development',
}

/** PR #131, as GitHub's unfurl gives it: the key in the host's words. */
export const PR131: Unfurl = {
  kind: 'change',
  product: 'github',
  key: 'PR #131',
  title: 'Handle a task branch that diverged from its PR',
  url: PR,
  state: 'merged',
  repository: 'AltharIDE/althar',
}

const MIN = 60_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
/** An item said `ms` ago, so the thread says "6m ago" or "just now". */
const at = (item: ThreadItem, ms: number): ThreadItem => ({ ...item, createdAt: ago(ms) })

const you = (text: string, links: ReadonlyArray<Unfurl>, ms: number) => at(items.you(text, undefined, links), ms)
const says = (text: string, ms: number) => at(items.says(text), ms)
const read = (title: string, ms: number) => at(items.tool({ title, toolKind: 'read' }), ms)

/* ——— What the person says, in each thread ——— */

const SAID: Record<'coordinator' | 'task', Record<Exclude<Scenario, 'agent'>, string>> = {
  coordinator: {
    short: `Can you plan this one? ${LINEAR}`,
    long: `I’ve been reading about Electron’s fuses. The Claude Code and Codex adapters still start as ELECTRON_RUN_AS_NODE children of the app itself, and that’s the one thing keeping the runAsNode fuse on. ${LINEAR} has the details. I’d like them on a Node of their own, the one we bundle, so we can turn the fuse off before 0.3. Don’t change how sign-in works, that’s a separate issue. Plan it as one task, and tell me if the packaged app needs anything new.`,
    two: `Can you take ${LINEAR} next? It touches the same code as ${PR}, so have the lead read that first.`,
  },
  task: {
    short: `This is what it’s for: ${LINEAR}`,
    long: `Before you go further: ${LINEAR} is what this is for. The adapters should start on the Node we bundle, not as ELECTRON_RUN_AS_NODE children of the app, so the runAsNode fuse can go off. Keep the download checked by its SHA-256 as you have it, and don’t touch how sign-in works. Say if the packaged app’s size grows by more than 40 MB.`,
    two: `Read ${PR} first: it changed how a task’s worktree finds its tools, and ${LINEAR} depends on that.`,
  },
}

const LINKS: Record<Exclude<Scenario, 'agent'>, ReadonlyArray<Unfurl>> = { short: [DEV68], long: [DEV68], two: [DEV68, PR131] }

/** The agent's reply, with a link of its own in the agent-link scenario: written as a Markdown link to the coordinator, pasted bare in the task. */
const REPLY: Record<'coordinator' | 'task', { plain: string; linked: string }> = {
  coordinator: {
    plain:
      'I read DEV-68. The adapters are spawned in `packages/provider-adapters/src/spawn.ts` with `ELECTRON_RUN_AS_NODE`; moving them onto the bundled Node is a change there and in the packaging script. I planned it as one task, on Claude Code.',
    linked:
      'I read DEV-68. The adapters are spawned in `packages/provider-adapters/src/spawn.ts` with `ELECTRON_RUN_AS_NODE`. The worktree code it touches was last changed in [PR #131](https://github.com/AltharIDE/althar/pull/131), so the lead should read that first. I planned it as one task, on Claude Code.',
  },
  task: {
    plain:
      'Understood. I’ll spawn the adapters from `Resources/node/bin/node` in `spawn.ts`, drop `ELECTRON_RUN_AS_NODE`, and set `RunAsNode` to false in the fuses. Sign-in stays as it is.',
    linked:
      'Understood. I’ll spawn the adapters from `Resources/node/bin/node` in `spawn.ts` and drop `ELECTRON_RUN_AS_NODE`. The tools’ paths follow what https://github.com/AltharIDE/althar/pull/131 did for the worktree, so nothing changes for a diverged branch.',
  },
}

/** Each read numbered on its own, well past the last, so the screens take it as a new thread rather than more of the old (reads.ts, `continued`). */
let reads = 0
const numbered = (thread: ReadonlyArray<ThreadItem>): ReadonlyArray<ThreadItem> => {
  reads += 1
  return thread.map((item, at) => ({ ...item, id: `r${reads}i${at}`, sequence: reads * 1000 + at }))
}

/** The coordinator's thread: an earlier exchange, the person's message with its links, the coordinator's reply. */
export const coordinatorItems = (scenario: Scenario): ReadonlyArray<ThreadItem> => {
  const said = scenario === 'agent' ? 'short' : scenario
  return numbered([
    you('What’s left before we can ship 0.3?', [], 9 * MIN),
    read('Read docs/plans/0.3.md', 9 * MIN),
    says(
      'Two things: the end-to-end flake on Linux, and the runAsNode fuse, which is still on because the agent adapters run on Electron’s own Node.',
      8.6 * MIN,
    ),
    you(SAID.coordinator[said], LINKS[said], 20_000),
    read('Read DEV-68 on Linear', 15_000),
    read('Read packages/provider-adapters/src/spawn.ts', 12_000),
    says(scenario === 'agent' ? REPLY.coordinator.linked : REPLY.coordinator.plain, 5_000),
  ])
}

/** A task's thread: the lead's work so far, the person's message with its links, the lead's reply. */
export const taskItems = (scenario: Scenario): ReadonlyArray<ThreadItem> => {
  const said = scenario === 'agent' ? 'short' : scenario
  return numbered([
    read('Read apps/desktop/scripts/package.ts', 7 * MIN),
    at(items.tool({ title: 'Edit apps/desktop/scripts/package.ts', toolKind: 'edit' }), 6.5 * MIN),
    says(
      'The packaged app had no Node of its own. The packaging script now downloads Node 24 for the target, checks it by its SHA-256, and puts it under `Resources/node`.',
      6 * MIN,
    ),
    you(SAID.task[said], LINKS[said], 20_000),
    read('Read DEV-68 on Linear', 15_000),
    says(scenario === 'agent' ? REPLY.task.linked : REPLY.task.plain, 5_000),
  ])
}

/** The task the task screen shows. */
export const TASK = {
  title: 'Bundle a Node for the agent adapters',
  slug: 'bundle-a-node',
  branch: 'althar/bundle-a-node',
}
