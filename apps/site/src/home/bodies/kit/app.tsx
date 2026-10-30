import {
  AcceptCard,
  Board,
  BoardColumn,
  BoardLane,
  BoardList,
  CallCard,
  EdgeSheet,
  Island,
  type IslandSaying,
  NextRow,
  ProjectTabs,
  SettledRow,
  TaskLaunch,
  type LaunchStep,
  WorkCard,
  type WorkCardProps,
  ModelPick,
} from '@althar/ui'
import type { ReactNode } from 'react'

import s from './app.module.css'
import {
  CALLS,
  CODEX,
  GEMINI_PRO,
  OPUS,
  QWEN,
  SONNET,
  EDGE_NEEDS,
  EDGE_WORK,
  edgeLineOf,
  FROM_231,
  MARKED,
  NEXT,
  NOTCH,
  PLAN_432,
  PROJECT,
  READY_TWO_REPOS,
  SETTLED,
} from './world'

/*
 * The app, as the pictures show it: whole windows and single pieces, drawn
 * by @althar/ui's own components with the kit's demo world (Tally, a
 * payments API, and task 432, the refunds backfill from Linear's TAL-231),
 * touched up where a picture wants it.
 */

const none = () => {}

/* ---- the bar every window shares: the tabs, with the system's lights drawn, and the screen's own controls at its end ---- */

const TABS = MARKED.map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: p.yours ? 1 : 0 }))

export function Tabs({ current, only = false, end }: { current: string | null; only?: boolean; end?: ReactNode }) {
  const tabs = only ? TABS.filter((tab) => tab.id === current) : TABS.slice(0, 3)
  return <ProjectTabs tabs={tabs} current={current} onSelect={none} onClose={none} yours={3} lights="drawn" end={end} />
}

/* ---- the lead's plan for task 432: its team, step by step ---- */

export function Launch({
  steps,
  wait = 30,
  task = '432',
  title = 'Backfill idempotency keys on refunds created before PR 1184',
  from = true,
  estimate,
  narrow = false,
}: {
  steps?: readonly LaunchStep[]
  wait?: number
  task?: string
  title?: string
  from?: boolean
  estimate?: string
  /** Laid out for a narrow window: each step's agents under its name, the estimate shorter. */
  narrow?: boolean
}) {
  const plan = steps ?? PLAN_432
  estimate ??= narrow ? 'About 40 min · about $2' : 'About 40 min · about $2 on your subscriptions'
  const launch = (
    <TaskLaunch
      task={task}
      title={title}
      {...(from ? { from: FROM_231 } : {})}
      project={PROJECT}
      estimate={estimate}
      steps={plan}
      picker={({ agent, owner }) => (
        <ModelPick
          variant="field"
          placement="below"
          owner={owner}
          model={agent}
          pinned={[]}
          effort="High"
          defaultEffort="High"
          onChange={none}
          onEffort={none}
        />
      )}
      wait={wait}
      onStart={none}
    />
  )
  return narrow ? <div className={s.narrowPlan}>{launch}</div> : launch
}

/** A plan growing a step at a time (`children`), over the room it takes once `whole`, so nothing under it moves as it grows. */
export function Growing({ children, whole }: { children: ReactNode; whole: ReactNode }) {
  return (
    <div className={s.reserve}>
      <div aria-hidden="true">{whole}</div>
      {children}
    </div>
  )
}

/* ---- at work: Tally's board with four tasks running at once, each led by another lab ---- */

/** A task running, and how it goes on: a step every `every` beats, and a minute a beat. */
interface AtWork extends Omit<WorkCardProps, 'elapsed' | 'onOpen' | 'text' | 'current'> {
  minutes: number
  every: number
}

const AT_WORK: readonly AtWork[] = [
  {
    task: '433',
    kind: 'Delivery',
    title: 'Rotate the webhook signing secrets',
    steps: ['Requirements', 'Implement', 'Review', 'Repair', 'Security review', 'Verify'],
    at: 2,
    minutes: 6,
    lead: OPUS,
    onStep: [SONNET],
    added: 1,
    every: 3,
  },
  {
    task: '419',
    kind: 'Delivery',
    title: 'Migrate billing webhooks to the v2 endpoint',
    steps: ['Requirements', 'Implement', 'Review', 'Verify'],
    at: 1,
    minutes: 22,
    lead: CODEX,
    every: 4,
  },
  {
    task: '424',
    kind: 'Session',
    title: 'Find a shape for webhook queue sharding',
    steps: ['Frame', 'Spike A', 'Spike B', 'Spike C', 'Replay', 'Note'],
    at: 3,
    minutes: 14,
    lead: GEMINI_PRO,
    every: 5,
  },
  {
    task: '435',
    kind: 'Delivery',
    title: 'Retry ledger exports on a 503',
    steps: ['Implement', 'Review', 'Verify'],
    at: 0,
    minutes: 3,
    lead: QWEN,
    every: 6,
  },
]

/** How long a task has run, as the board says it: 6m, 1h 12m. */
const ran = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`)

/** Tally's board `beat` beats on: each running task a step further at its own pace, and staying on its last. */
export function BoardAtWork({ beat }: { beat: number }) {
  return (
    <Board label="Tally’s work">
      <BoardColumn lane={BoardLane.Next} count={NEXT.length}>
        <BoardList>
          {NEXT.map((x, i) => (
            <NextRow key={x.task} {...x} place={i + 1} />
          ))}
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={AT_WORK.length}>
        {AT_WORK.map(({ minutes, every, ...x }) => (
          <WorkCard key={x.task} {...x} at={Math.min(x.at + Math.floor(beat / every), x.steps.length - 1)} elapsed={ran(minutes + beat)} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={CALLS.length}>
        <AcceptCard {...READY_TWO_REPOS} />
        {CALLS.slice(0, 2).map((x) => (
          <CallCard key={x.title} {...x} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Settled} count={SETTLED.length}>
        <BoardList>
          {SETTLED.map((x) => (
            <SettledRow key={x.task} {...x} />
          ))}
        </BoardList>
      </BoardColumn>
    </Board>
  )
}

/* ---- the island, round the notch, and what drops from it ---- */

export function IslandOpen({
  open = true,
  saying,
  waiting = EDGE_NEEDS.length,
}: {
  open?: boolean
  saying?: IslandSaying
  waiting?: number
}) {
  return (
    <Island notch={NOTCH} waiting={waiting} open={open} onOpenChange={none} onOpenApp={none} saying={saying ?? null}>
      <EdgeSheet
        tone="ink"
        waiting={EDGE_NEEDS.length}
        needs={EDGE_NEEDS.map((call) => edgeLineOf(call, none))}
        work={EDGE_WORK}
        onOpenApp={none}
      />
    </Island>
  )
}
