import {
  AcceptCard,
  Board,
  BoardColumn,
  BoardLane,
  BoardList,
  Button,
  CallCard,
  ChromeButton,
  Composer,
  EdgeSheet,
  IconButton,
  Island,
  Logo,
  NeedCard,
  NeedChange,
  NeedCommand,
  NeedOptions,
  NextRow,
  ProjectHead,
  ProjectTabs,
  Review,
  Room,
  RoomSwitch,
  SettledRow,
  TaskLaunch,
  type LaunchStep,
  TitleBar,
  Turn,
  Verdict,
  FindingState,
  WorkCard,
  WorkStatus,
  You,
  ModelPick,
} from '@althar/ui'
import { Home } from '@althar/ui/screens'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

// Prototype: the kit's demo world, read from its source. Ported, the site would keep its own copy.
import { CALLS, NEXT, READY_TWO_REPOS, RUNNING as BOARD_RUNNING, SETTLED } from '../../../../../../packages/ui/src/fixtures/board'
import { FROM_231, PLAN_432 } from '../../../../../../packages/ui/src/fixtures/coordinator'
import { EDGE_NEEDS, EDGE_WORK, edgeRowOf, NOTCH } from '../../../../../../packages/ui/src/fixtures/edge'
import { DECISION, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../../../../../../packages/ui/src/fixtures/home'
import { MARKED } from '../../../../../../packages/ui/src/fixtures/marks'
import { FINDINGS, PROJECT, reviewDoc, STEPS } from '../../../../../../packages/ui/src/fixtures/meridian'
import { CODEX, GEMINI_PRO, SONNET } from '../../../../../../packages/ui/src/fixtures/models'
import s from './app.module.css'

/*
 * The app, as the pictures show it: whole windows and single pieces, drawn
 * by @althar/ui's own components with the kit's demo world (Meridian, a
 * payments API, and task 432, the refunds backfill from Linear's MER-231),
 * touched up where a picture wants it.
 */

const none = () => {}

/* ---- the frame every window shares: the tabs, with the system's lights drawn ---- */

const TABS = MARKED.map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: p.yours ? 1 : 0 }))

export function Tabs({ current }: { current: string | null }) {
  return <ProjectTabs tabs={TABS.slice(0, 3)} current={current} onSelect={none} onClose={none} yours={3} lights="drawn" />
}

/* ---- the home: what needs you across every project, what runs, what happened ---- */

export function HomeWindow({
  className,
  style,
  looked = '3 h ago',
  narrow = false,
}: {
  className?: string
  style?: CSSProperties
  looked?: string
  /** Laid out for a narrow window: the stream alone. */
  narrow?: boolean
}) {
  const needs = [
    <NeedCard
      key="publish"
      kind={PUBLISH.kind}
      project={PUBLISH.project}
      task={PUBLISH.task}
      title={PUBLISH.title}
      at={PUBLISH.at}
      detail={<NeedCommand command={PUBLISH.command} agent={PUBLISH.agent} step={PUBLISH.step} />}
      actions={
        <>
          <Button size="small">Deny</Button>
          <Button size="small" variant="signal">
            Allow once
          </Button>
        </>
      }
    />,
    <NeedCard
      key="accept"
      kind={READY.kind}
      project={READY.project}
      task={READY.task}
      title={READY.title}
      at={READY.at}
      detail={<NeedChange {...READY.change} />}
      actions={<Button size="small">Review</Button>}
    />,
    <NeedCard
      key="decision"
      kind={DECISION.kind}
      project={DECISION.project}
      task={DECISION.task}
      title={DECISION.title}
      at={DECISION.at}
      detail={<NeedOptions options={DECISION.options} />}
      actions={<Button size="small">Decide</Button>}
    />,
  ]
  return (
    <div className={`${s.window} ${narrow ? s.narrow : ''} ${className ?? ''}`} style={style}>
      {!narrow && <Tabs current={null} />}
      <TitleBar
        lights="none"
        end={
          <>
            <WorkStatus running={RUNNING.length} yours={3} />
            <IconButton icon="gear" label="Settings" kbd="⌘," size="small" />
          </>
        }
      >
        <span className={s.brand}>
          <Logo size={15} />
          Althar
        </span>
      </TitleBar>
      <div className={s.body}>
        <Home
          waiting={3}
          needs={needs}
          running={RUNNING}
          since={SINCE}
          looked={looked}
          projects={PROJECT_LIST}
          onOpenTask={none}
          onOpenEvent={none}
          onOpenProject={none}
          onTalk={none}
          onOpenFolder={none}
        />
      </div>
    </div>
  )
}

/* ---- the lead's plan for task 432: its team, step by step ---- */

/** The plan, put together a step at a time when `assemble` is set, as the lead does it. */
export function useAssembling(assemble: boolean, plan: readonly LaunchStep[] = PLAN_432) {
  const [shown, setShown] = useState(assemble ? 0 : plan.length)
  useEffect(() => {
    // With motion reduced, the plan is simply there.
    if (!assemble || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(plan.length)
    setShown(0)
    let n = 0
    const timer = window.setInterval(() => {
      n += 1
      setShown(n)
      if (n >= plan.length) window.clearInterval(timer)
    }, 520)
    return () => window.clearInterval(timer)
  }, [assemble, plan])
  return plan.slice(0, shown)
}

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

/* ---- a project, its conversation beside its board, as Both shows it ---- */

const ASK = 'Backfill idempotency keys on the refunds made before PR 1184. MER-231 has the details.'

export function ProjectWindow({
  conversation,
  thread,
  talkOnly = false,
  centered = false,
  meta = 'Payments API · 3 repositories',
  className,
  style,
}: {
  /** What the conversation shows under your ask; by default, the lead's plan. */
  conversation?: ReactNode
  /** The whole conversation, in place of your ask, the reply and `conversation`. */
  thread?: ReactNode
  /** Only the conversation, as on a narrow window. */
  talkOnly?: boolean
  /** Only the conversation, in a column down the middle of a wide window. */
  centered?: boolean
  meta?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`${s.window} ${talkOnly ? s.talkOnly : ''} ${centered ? s.centered : ''} ${className ?? ''}`} style={style}>
      {!talkOnly && <Tabs current="meridian" />}
      <TitleBar
        lights="none"
        end={
          <>
            {!talkOnly && <WorkStatus running={4} yours={2} />}
            <ChromeButton icon="plus" label="New task" />
          </>
        }
      >
        <RoomSwitch value={talkOnly || centered ? Room.Talk : Room.Both} onChange={none} text={{ key: () => '' }} />
      </TitleBar>
      <div className={s.rooms}>
        <div className={s.talk}>
          <ProjectHead title="Meridian" meta={meta} side={!centered} />
          <div className={s.thread}>
            {thread ?? (
              <>
                <You at="11:01">{ASK}</You>
                <Turn voice="Meridian’s coordinator" at="11:01">
                  <p className={s.said}>One task. It writes to money records, so your security review applies, and a second lab reviews.</p>
                </Turn>
                {conversation ?? <Launch />}
              </>
            )}
          </div>
          <div className={s.composer}>
            <Composer value="" onChange={none} onSubmit={none} placeholder="Tell Meridian what you want done" hint="⌘L" />
          </div>
        </div>
        {!talkOnly && !centered && (
          <div className={s.board}>
            <MeridianBoard />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---- Meridian's board ---- */

export function MeridianBoard() {
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={NEXT.length}>
        <BoardList>
          {NEXT.map((x, i) => (
            <NextRow key={x.task} {...x} place={i + 1} />
          ))}
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={BOARD_RUNNING.length}>
        {BOARD_RUNNING.map((x) => (
          <WorkCard key={x.task} {...x} />
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

/* ---- two labs' review of the lead's work ---- */

/** The usual review, simpler: two findings the lead fixed on the second round, and the one the reviewers disagree on, which is yours. */
const FINDINGS_ONE_YOURS = FINDINGS.map((f) =>
  f.id === 'f2'
    ? {
        ...f,
        state: FindingState.Yours,
        ask: 'Sonnet and Gemini disagree, and nothing on the task settles it. One budget, or a bucket for refunds?',
      }
    : { ...f, state: FindingState.Fixed, round: 2 },
)

export function TwoLabReview() {
  return (
    <Review
      n={3}
      of={6}
      reviewers={[{ model: SONNET }, { model: GEMINI_PRO }]}
      verdict={Verdict.Changes}
      took="4m 20s"
      thread={STEPS.review}
      instructions={{ path: '.althar/review.md', ...reviewDoc }}
      defaultFindings={FINDINGS_ONE_YOURS}
      defaultOpen
    />
  )
}

/** The docs task the coordinator hands out beside 432: small, Codex writes, Sonnet reads it over. */
export const DOCS_PLAN: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [CODEX], why: 'a docs change; Codex has room', fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [SONNET], why: 'a different lab from the lead', optional: true },
]

/* ---- the island, round the notch, and what drops from it ---- */

export function IslandOpen({
  open = true,
  saying,
  waiting = EDGE_NEEDS.length,
  running = EDGE_WORK.length,
}: {
  open?: boolean
  saying?: { project: string; kind: string }
  waiting?: number
  running?: number
}) {
  return (
    <Island notch={NOTCH} waiting={waiting} running={running} open={open} onOpenChange={none} onOpenApp={none} saying={saying ?? null}>
      {/* Touched up: the ink sheet doesn't yet set the code chip's paper (a task is open for the app). */}
      <EdgeSheet
        tone="ink"
        style={{ '--n-4': 'rgba(255, 255, 255, 0.1)' } as CSSProperties}
        waiting={EDGE_NEEDS.length}
        working={EDGE_WORK.length}
        needs={EDGE_NEEDS.map((row) => edgeRowOf(row, none))}
        work={EDGE_WORK.map((row) => edgeRowOf(row, none))}
        onOpenApp={none}
      />
    </Island>
  )
}
