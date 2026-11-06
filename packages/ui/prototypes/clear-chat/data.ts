// Scrappy: althar's conversation with its coordinator today, as the runtime would give it, and what the coordinator says on this page.
import { card, items } from '../../../../apps/desktop/tests/fixtures'
import type { ThreadItem } from './deps'

const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const at = (item: ThreadItem, ago: number): ThreadItem => ({ ...item, createdAt: minutes(ago) })

export const TASKS = {
  gitlab: {
    taskId: 'tk-gitlab',
    threadId: 'th-gitlab',
    title: 'Connectors: GitLab pages past 100',
    slug: 'connectors-gitlab-pages-past-100',
  },
  flatpak: { taskId: 'tk-flatpak', threadId: 'th-flatpak', title: 'Flatpak: git over SSH', slug: 'flatpak-git-over-ssh' },
  clearing: {
    taskId: 'tk-clearing',
    threadId: 'th-clearing',
    title: 'Prototype: clearing a coordinator chat',
    slug: 'prototype-clearing-a-coordinator-chat',
  },
} as const

const opus = { lead: 'claude-code', leadModel: 'claude-opus-5-5', leadEffort: 'xhigh' } as const
const steps = [
  { key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false },
  { key: 'review' as const, agentId: 'codex', model: 'gpt-6.1-sol', skipped: false },
]

/** The GitLab task, at its review, with the errand the person gave the coordinator for it. */
export const gitlabCard = () =>
  card({
    ...TASKS.gitlab,
    ...opus,
    phase: 'running',
    step: 'review',
    plan: { id: 'pln-gitlab', steps, startsAt: null, reason: null, end: null },
    branch: 'althar/connectors-gitlab-pages-past-100',
    startedAt: minutes(170),
    summary: 'Reads every page of pipelines and statuses, not the first 100.',
    errands: ['Merge it once its checks pass'],
  })

/** The prototype, planned: it starts on its own in a few minutes unless the person holds it. */
export const clearingCard = () =>
  card({
    ...TASKS.clearing,
    ...opus,
    phase: 'planned',
    plan: { id: 'pln-clearing', steps, startsAt: new Date(Date.now() + 4 * 60_000).toISOString(), reason: null, end: null },
    branch: 'althar/prototype-clearing-a-coordinator-chat',
  })

/** Today's conversation, oldest first: a task at work, one merged, an issue drafted and a plan waiting to start. */
export const conversation = (): ThreadItem[] => [
  at(items.you('GitLab pipelines stop at 100 on the connector. Can you get that fixed?'), 190),
  at(items.tool({ title: 'Searched tasks for “GitLab”', toolKind: 'search' }), 189),
  at(
    items.says(
      'Nothing open covers it. Planned **Connectors: GitLab pages past 100** on Opus 5.5, reviewed by GPT-6.1 Sol. It reads every page of pipelines and statuses, not just the first.',
    ),
    189,
  ),
  at(items.card(gitlabCard(), 'card-gitlab'), 188),
  at(items.you('Once its checks pass, merge it.'), 150),
  at(items.says('I’ll merge it once its checks pass.'), 150),
  at(items.you('Is the Flatpak SSH change in?'), 120),
  at(items.tool({ title: 'Read flatpak-git-over-ssh', toolKind: 'read' }), 120),
  at(items.says('Yes: [#337](https://github.com/AltharIDE/althar/pull/337) merged at 10:12, and the task is settled.'), 119),
  at(
    items.card(
      card({
        ...TASKS.flatpak,
        ...opus,
        phase: 'settled',
        step: null,
        plan: null,
        branch: 'althar/flatpak-git-over-ssh',
        startedAt: minutes(600),
        summary: 'Git over SSH in the Flatpak: pinned host keys, the ssh-agent.',
      }),
      'card-flatpak',
    ),
    119,
  ),
  at(items.you('The board’s lane counts jump when a task moves between lanes. Draft an issue.'), 60),
  at(items.says('Drafted it for you to file.'), 59),
  at(
    items.draft({
      draftId: 'idr-lanes',
      product: 'linear',
      tracker: 'Linear',
      container: 'Althar',
      title: 'Board: lane counts jump while a task moves',
      body: 'A task sliding to another lane changes both counts before it lands, so the numbers flicker. Count it in the lane it lands in, once it lands.',
      labels: ['board'],
    }),
    59,
  ),
  at(items.you('Plan the prototype for clearing a coordinator chat. It’s several directions, so xhigh.'), 25),
  at(items.says('Planned it on Opus 5.5 at xhigh, reviewed by GPT-6.1 Sol. It starts in a few minutes unless you hold it.'), 24),
  at(items.card(clearingCard(), 'card-clearing'), 24),
  at(items.you('How much of the week’s plan usage is left?'), 5),
  at(items.says('About 38% of the week is left on your Claude account; it resets Monday at 09:00. Codex is at 71%.'), 5),
]

/** What still needs the person or is at work: it stays in view whatever is cleared. */
export const stillOpen = (item: ThreadItem): boolean =>
  (item.kind === 'task' && item.content.phase !== 'settled') ||
  (item.kind === 'issue_draft' && item.content.state === 'pending') ||
  (item.kind === 'issue_changes' && item.content.state === 'pending') ||
  (item.kind === 'question' && item.content.state === 'open') ||
  (item.kind === 'task_ask' && item.content.state === 'open')

/** What the coordinator remembers, as C writes it into a new conversation: its first word there. */
export const SUMMARY = [
  'Carried over from our last conversation:',
  '',
  '- **Connectors: GitLab pages past 100** is in review. You asked me to merge it once its checks pass.',
  '- **Prototype: clearing a coordinator chat** is planned on Opus 5.5 at xhigh.',
  '- The lane-count issue is drafted, waiting for you to file it.',
  '- About 38% of the week’s Claude usage is left; Codex is at 71%.',
].join('\n')

/** What the coordinator answers on this page, by what it remembers: the whole conversation, a summary of it, or nothing of it. */
export const REPLY = {
  kept: 'We were on three things: **Connectors: GitLab pages past 100** is in review, and I’ll merge it once its checks pass; **Prototype: clearing a coordinator chat** starts in a few minutes; and the lane-count issue is waiting for you to file it. And 38% of the week’s Claude usage is left.',
  summary:
    'From what I carried over: the GitLab paging task is in review and I’ll merge it once its checks pass; the clearing prototype starts shortly; the lane-count issue is yours to file. For anything else we said, I can read the last conversation.',
  fresh:
    'I’ve nothing of an earlier conversation, only the project’s records: **Connectors: GitLab pages past 100** is in review, with an errand to merge it once its checks pass, and **Prototype: clearing a coordinator chat** is planned. What would you like to pick up?',
}
