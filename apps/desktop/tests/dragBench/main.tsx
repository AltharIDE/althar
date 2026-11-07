import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { Activity, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { BoardSnapshot, BoardTask, ThreadItem } from '@althar/contracts'

import { ServicesProvider } from '../../src/renderer/data/services'
import { useBoard } from '../../src/renderer/features/board/useBoard'
import { useConnections } from '../../src/renderer/features/connections/useConnections'
import { ProjectView } from '../../src/renderer/features/project/ProjectView'
import { useProject } from '../../src/renderer/features/project/useProject'
import { card, coordinatorSnapshot, fakeClient, items } from '../fixtures'
import { servicesFor, useSettingsOf } from '../render'

/*
 * The project's Home as the person had it when the divider lagged: a long
 * conversation with the coordinator, its replies holding a mermaid diagram,
 * tables and code, beside a board of four lanes with 28 cards settled.
 * run.ts drags the divider over it and times the frames.
 */

const reply = (n: number) => `## Where the ledger stands (${n})

The motor and action ledger keeps every move an agent makes, so a task can be read back step by step. Here is how the pieces fit together, and what each of the open tasks changes in it.

\`\`\`mermaid
flowchart LR
  A[Agent turn] --> B{Tool call}
  B -->|asks| C[Permission]
  B -->|runs| D[Ledger row]
  C --> D
  D --> E[Board card]
  D --> F[Thread item]
  E --> G[Settled]
\`\`\`

| Task | Lane | Files | Lead | Notes |
| --- | --- | --- | --- | --- |
| Motor and action ledger | Running | 14 | Claude Code | the rows, their indexes, and the reads that page them |
| Choose where task folders go | Up next | 11 | Codex | a setting, a check that the folder is writable, and the move |
| Warn before sign-in ends | Needs you | 8 | Claude Code | the registry reads expiry; the composer says it a day before |
| Recognise forks whatever their remotes | Settled | 12 | Claude Code | the connectors match by URL, not by remote name |
| Light theme meets AA contrast | Settled | 21 | Codex | the inks move a step darker where they fail |

Each of them touches the ledger only through its reads, so none should conflict with another. The one to watch is **Choose where task folders go**: it moves worktrees, and the ledger keeps paths.

\`\`\`ts
export const ledgerRow = (turn: Turn, call: ToolCall): LedgerRow => ({
  id: rowId(),
  turnId: turn.id,
  tool: call.kind,
  title: call.title,
  status: call.status,
  at: new Date().toISOString(),
})
\`\`\`

1. Read the ledger's rows a page at a time, newest first, so a long task opens fast.
2. Keep the index on \`(thread_id, at)\`; the plan check fails a read that scans the table whole.
3. Say on the card how many rows a task wrote, and where it stopped.

> A row is never changed once written: a correction is a row of its own, pointing back at what it corrects.

${'The rest of the reply walks through each step in more detail, with what was tried and why it was set aside. '.repeat(6)}`

const thread: ReadonlyArray<ThreadItem> = Array.from({ length: 24 }, (_, n) => [
  items.you(`What does the ledger look like now, and what changes next? (${n})`),
  items.says(reply(n), 'claude-code'),
]).flat()

const task = (n: number, overrides: Partial<BoardTask>): BoardTask => ({
  ...card({ taskId: `t${n}`, threadId: `th${n}`, title: `Task ${n}`, slug: `task-${n}`, plan: null }),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const titles = [
  'Motor and action ledger, read a page at a time',
  'Choose where task folders go, and move them',
  'Warn before an agent sign-in ends; say why it can’t start',
  'Recognise forks whatever their remotes are called',
  'Light theme meets WCAG AA contrast',
  'Show git’s error on failures; repair broken worktrees',
]
const titleOf = (n: number) => `${titles[n % titles.length] ?? ''} (${n})`

const board: BoardSnapshot = {
  cursor: 3,
  tasks: [
    ...[1, 2].map((n) => task(n, { title: titleOf(n), phase: 'planned' })),
    ...[3, 4, 5].map((n) => task(n, { title: titleOf(n), phase: 'running', step: 'implement', startedAt: '2026-10-01T09:00:00.000Z' })),
    ...[6, 7].map((n) => task(n, { title: titleOf(n), phase: 'ready' })),
    ...Array.from({ length: 28 }, (_, i) =>
      task(10 + i, {
        title: titleOf(10 + i),
        phase: 'settled',
        state: 'done',
        settledAt: new Date(Date.UTC(2026, 9, 1, 8, 59 - i)).toISOString(),
        summary: 'Merged. The board reads its rows a page at a time.',
      }),
    ),
  ],
  calls: [],
  settledTotal: 28,
}

const { client } = fakeClient({
  getCoordinator: async (projectId) => coordinatorSnapshot({ project: { id: projectId, name: projectId }, items: thread }),
  getBoard: async () => board,
})
const services = servicesFor(client)

function Home({ projectId }: { projectId: string }) {
  return (
    <ProjectView
      model={useProject(projectId)}
      board={useBoard(projectId)}
      connections={useConnections()}
      settings={useSettingsOf(projectId)}
      onTask={() => undefined}
    />
  )
}

/* Two projects' tabs, kept as the window keeps them (KeptScreens): `window.showProject` switches, as a tab does. */
function Tabs() {
  const [shown, setShown] = useState('p1')
  useEffect(() => {
    Object.assign(window, { showProject: setShown })
  }, [])
  return ['p1', 'p2'].map((projectId) => (
    <Activity key={projectId} mode={projectId === shown ? 'visible' : 'hidden'}>
      <Home projectId={projectId} />
    </Activity>
  ))
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <ServicesProvider value={services}>
      <Tabs />
    </ServicesProvider>,
  )
