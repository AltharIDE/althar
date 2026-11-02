import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { device } from '../../foundations/device'
import { Board, BoardColumn, BoardList } from '../../board/Board/Board'
import { CallCard } from '../../board/CallCard/CallCard'
import { PullChip } from '../../board/BoardCard/Chips'
import { NextRow } from '../../board/NextRow/NextRow'
import { WorkCard } from '../../board/WorkCard/WorkCard'
import { TitleBar } from '../../chrome/TitleBar/TitleBar'
import { WorkStatus } from '../../chrome/WorkStatus/WorkStatus'
import { TaskCard } from '../../coordinator/TaskCard/TaskCard'
import { CallPeek } from '../../dock/CallPeek/CallPeek'
import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BoardLane, FindingState, RuntimeState, StepState, TaskStatus, ToolState, Verdict } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Panel } from '../../primitives/Panel/Panel'
import { ReviewSealGlyph } from '../../setup/ReviewSeal/ReviewSeal'
import { Runtimes, type RuntimeEntry } from '../../setup/Runtimes/Runtimes'
import { Review, type ReviewFinding } from '../../thread/Review/Review'
import { You } from '../../thread/You/You'
import {
  AGENTS,
  CALL,
  FINDINGS,
  FIX,
  DOING,
  GEMINI,
  GPT,
  NEXT_UP,
  OPUS,
  REVIEWING,
  RUNNING_421,
  SEAL,
  SEALED,
  SET_ASIDE,
  SONNET,
  STEPS,
  TASK,
} from './demo'
import { Note, find, rectIn, useScene } from './Station'

const GITHUB = { name: 'GitHub', brand: Brand.GitHub }
import s from './scenes.module.css'

/*
 * The five scenes. Each is made of the real components, holding the demo
 * project's state, with a script that changes that state the way Althar
 * would, and a pointer where a person would act. `end` is where the script
 * finishes, so leaving a scene early, or arriving with no motion, shows the
 * same final picture.
 */

export interface SceneProps {
  live: boolean
  instant: boolean
}

const noop = () => {}

/* Things that change place glide there: measured before and after, relative to the scene. Arriving instant, nothing moves. */
function useGlide(root: RefObject<HTMLElement | null>, instant: boolean) {
  const last = useRef(new Map<string, { x: number; y: number }>())
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const k = box.width ? el.offsetWidth / box.width : 1
    const next = new Map<string, { x: number; y: number }>()
    const first = last.current.size === 0
    const can = !instant && typeof el.animate === 'function'
    el.querySelectorAll<HTMLElement>('[data-glide]').forEach((n) => {
      const r = n.getBoundingClientRect()
      const at = { x: (r.left - box.left) * k, y: (r.top - box.top) * k }
      const id = n.dataset.glide ?? ''
      next.set(id, at)
      const was = last.current.get(id)
      if (!can) return
      if (was && (Math.abs(was.x - at.x) > 1 || Math.abs(was.y - at.y) > 1))
        n.animate([{ transform: `translate(${was.x - at.x}px, ${was.y - at.y}px)` }, { transform: 'none' }], {
          duration: 760,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
        })
      /* something new arrives from the left, the way work moves across the board, and unfolds */
      else if (!was && !first)
        n.animate(
          [
            { opacity: 0, transform: 'translateX(-24px)', clipPath: 'inset(0 0 100% 0 round 12px)' },
            { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0 round 12px)' },
          ],
          { duration: 640, easing: 'cubic-bezier(0.22, 0.61, 0.24, 1)' },
        )
    })
    last.current = next
  })
}

/*
 * Each scene holds the room it ends with from the start (the min-heights in
 * its styles), so its plot on the table and the camera's framing are the size
 * of the finished scene.
 */

/* ---- 02 · a task and its lead ------------------------------------------------- */

const REPLY =
  'One task. Opus 5 leads it and writes the change; GPT-5.2 and Gemini 3 Pro review it. A security review joins because it touches auth.'

export function TaskScene({ live, instant }: SceneProps) {
  const [shown, setShown] = useState(0)
  const [at, setAt] = useState(0)
  const [notes, setNotes] = useState(0)
  const pointer = useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(1400)
      setShown(1)
      await stage.wait(1500)
      setShown(2)
      await stage.wait(900)
      setNotes(1)
      await stage.wait(700)
      setNotes(2)
      for (const i of [1, 2, 3]) {
        await stage.wait(1000)
        setAt(i)
        if (i === 2) setNotes(3)
      }
    },
    () => {
      setShown(2)
      setAt(3)
      setNotes(3)
    },
  )
  return (
    <div className={s.task}>
      <div className={s.threadHead}>
        <Icon name="agents" size={13} />
        Coordinator
      </div>
      <div className={s.thread}>
        <You at="now">Token refresh breaks when someone’s role changes. Fix it, and keep the old cache.</You>
        {shown > 0 && (
          <p className={s.reply}>
            {REPLY.split(' ').map((word, i) => (
              <span key={i} className={s.word} style={{ animationDelay: `${i * 32}ms` }}>
                {word}{' '}
              </span>
            ))}
          </p>
        )}
        {shown > 1 && (
          <div className={s.enter}>
            <TaskCard {...TASK} status={TaskStatus.Running} steps={STEPS} at={at} now={DOING[at]} started="just now" lead={OPUS} fresh />
          </div>
        )}
      </div>
      {notes > 0 && <Note target="One task." side="left" reach={44} label="The coordinator plans; it writes no code" />}
      {notes > 1 && <Note target="Opus 5" side="bottom" from="far" reach={40} shift={-40} label="The lead: the agent in charge" />}
      {notes > 2 && <Note target="Verify" side="bottom" from="far" reach={40} shift={-20} label="Steps report back to the lead" />}
      {pointer}
    </div>
  )
}

/* ---- 03 · the calls are yours ------------------------------------------------- */

export function CallsScene({ live, instant }: SceneProps) {
  const [leaving, setLeaving] = useState(false)
  const [started, setStarted] = useState(false)
  const [call, setCall] = useState<'none' | 'waiting' | 'open' | 'closing' | 'answered'>('none')
  const [notes, setNotes] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  useGlide(root, instant)
  const pointer = useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(1500)
      setLeaving(true)
      await stage.wait(360)
      setStarted(true)
      await stage.wait(900)
      setNotes(1)
      await stage.wait(900)
      setCall('waiting')
      await stage.wait(700)
      setNotes(2)
      await stage.wait(1100)
      await stage.point(CALL.title)
      await stage.press()
      await stage.wait(700)
      await stage.point('Queue and retry with backoff', 'aside')
      await stage.press()
      await stage.point('Record decision', 'aside')
      await stage.press()
      stage.rest()
      await stage.wait(360)
      setCall('answered')
      await stage.wait(500)
      setNotes(3)
    },
    () => {
      setStarted(true)
      setCall('answered')
      setNotes(3)
    },
  )
  /* 421 waits on you until you record; the call's card and the dock stay a moment longer, leaving */
  const held = call === 'waiting' || call === 'open'
  const shown = held || call === 'closing'
  const next = started ? NEXT_UP.slice(1) : NEXT_UP
  const running = [
    { ...TASK, status: TaskStatus.Running, steps: STEPS, at: 2, elapsed: '14m', lead: OPUS, onStep: [SONNET], note: DOING[2] },
    {
      ...RUNNING_421,
      status: held ? TaskStatus.Yours : TaskStatus.Running,
      steps: ['Implement', 'Review', 'Verify'],
      at: held ? 0 : 1,
      elapsed: '6m',
      lead: GPT,
      note: held ? 'waiting on your call' : 'retries with backoff, as you chose',
    },
    ...(started
      ? [
          {
            ...NEXT_UP[0]!,
            status: TaskStatus.Running,
            steps: ['Implement', 'Verify'],
            at: 0,
            elapsed: 'now',
            lead: GEMINI,
            note: 'reading the refunds table',
          },
        ]
      : []),
  ]
  return (
    <div ref={root} className={s.calls}>
      <TitleBar lights="drawn" className={s.bar} end={<WorkStatus running={running.length} yours={held ? 1 : 0} onYours={noop} />}>
        <span className={s.barName}>Meridian</span>
      </TitleBar>
      <div className={s.boardWrap}>
        <Board label="Meridian’s work" className={s.board}>
          <BoardColumn lane={BoardLane.Next} count={next.length}>
            <BoardList>
              {next.map((x, i) => (
                <div key={x.task} data-glide={`next-${x.task}`} className={cx(leaving && !started && i === 0 && s.leaveRight)}>
                  <NextRow {...x} place={i + 1} onOpen={noop} />
                </div>
              ))}
            </BoardList>
          </BoardColumn>
          <BoardColumn lane={BoardLane.Running} count={running.length}>
            {running.map((x) => (
              <div key={x.task} data-glide={x.task}>
                <WorkCard {...x} onOpen={noop} />
              </div>
            ))}
          </BoardColumn>
          <BoardColumn lane={BoardLane.Yours} count={held ? 1 : 0}>
            {shown && (
              <div data-glide="call" className={cx(call === 'closing' && s.leaveLeft)}>
                <CallCard
                  kind={CALL.kind}
                  title={CALL.title}
                  because={CALL.because}
                  options={CALL.options.map((o) => o.label)}
                  holds={['421']}
                  at="now"
                  current={call === 'open'}
                  onOpen={() => setCall('open')}
                />
              </div>
            )}
          </BoardColumn>
        </Board>
        {(call === 'open' || call === 'closing') && (
          <aside className={cx(s.dock, call === 'closing' && s.dockLeaving)}>
            <div className={s.dockHead}>
              <span className={s.dockKind}>{CALL.kind}</span>
              <span className={s.dockFrom}>Task 421 · now</span>
            </div>
            <div className={s.dockBody}>
              <CallPeek
                title={CALL.title}
                because={CALL.because}
                options={CALL.options}
                releases="Releases task 421"
                onRecord={() => setCall('closing')}
              />
            </div>
          </aside>
        )}
      </div>
      {notes > 0 && <Note target="Backfill idempotency" side="left" reach={52} shift={-40} label="Work moves on its own" />}
      {notes > 1 && call === 'waiting' && <Note target={CALL.title} side="bottom" reach={56} label="Only this waits for you" />}
      {notes > 2 && <Note target="Nothing here needs you" side="top" reach={48} shift={-40} label="Answered: back to the work" />}
      {pointer}
    </div>
  )
}

/* ---- 04 · reviewed before you see it ------------------------------------------ */

/* The review as the lead settles it: one finding fixed in the second round, one set aside with its reason. */
const settled = (finding: ReviewFinding): ReviewFinding =>
  finding.id === FIX ? { ...finding, state: FindingState.Fixed, round: 2 } : { ...finding, state: FindingState.Aside, reason: SET_ASIDE }

export function ReviewScene({ live, instant }: SceneProps) {
  const [read, setRead] = useState(false)
  const [findings, setFindings] = useState(FINDINGS)
  const [sealed, setSealed] = useState(false)
  const [notes, setNotes] = useState(0)
  const pointer = useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(1500)
      setRead(true)
      await stage.wait(700)
      setNotes(1)
      await stage.wait(1300)
      setFindings((now) => now.map((f) => (f.id === FIX ? settled(f) : f)))
      await stage.wait(900)
      setFindings((now) => now.map(settled))
      setNotes(2)
      await stage.wait(1300)
      setSealed(true)
      await stage.wait(600)
      setNotes(3)
    },
    () => {
      setRead(true)
      setFindings(FINDINGS.map(settled))
      setSealed(true)
      setNotes(3)
    },
  )
  return (
    <div className={s.review}>
      <Review
        n={2}
        of={4}
        reviewers={[read ? { model: GPT } : { model: GPT, state: ToolState.Running, meta: REVIEWING }]}
        state={read ? StepState.Done : StepState.Running}
        findings={findings}
        {...(read ? { verdict: Verdict.Changes, took: '3m 10s' } : {})}
        open={read}
      />
      <div className={s.sealed} data-shown={sealed || undefined} aria-hidden={!sealed || undefined}>
        <PullChip host={GITHUB} repo="meridian/api" number={1191} />
        <span className={s.sealedWords}>{SEALED}</span>
        <ReviewSealGlyph facts={SEAL} size={52} />
      </div>
      {notes > 0 && <Note target="GPT-5.2" side="left" from="far" reach={44} label="Another maker reads the change" />}
      {notes > 1 && <Note target={SET_ASIDE.slice(0, 24)} side="right" from="far" reach={44} label="The lead fixes it, or says why not" />}
      {notes > 2 && <Note target={SEALED} side="bottom" from="far" reach={36} label="The pull request carries the review" />}
      {pointer}
    </div>
  )
}

/* ---- 05 · your agents -------------------------------------------------------- */

export function AgentsScene({ live, instant }: SceneProps) {
  const [codex, setCodex] = useState<RuntimeState.Checking | RuntimeState.Ready>(RuntimeState.Checking)
  const [wired, setWired] = useState(false)
  const [notes, setNotes] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const pointer = useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(1700)
      setCodex(RuntimeState.Ready)
      await stage.wait(600)
      setWired(true)
      await stage.wait(900)
      setNotes(1)
      await stage.wait(700)
      setNotes(2)
    },
    () => {
      setCodex(RuntimeState.Ready)
      setWired(true)
      setNotes(2)
    },
  )
  return (
    <div ref={root} className={s.agents}>
      <Panel title={`Agents on ${device.this}`} className={s.agentsPanel}>
        <div className={s.block}>
          <Runtimes
            label={`Agents on ${device.this}`}
            runtimes={AGENTS.map((a): RuntimeEntry =>
              a.id === 'codex' && codex === RuntimeState.Checking ? { id: a.id, name: a.name, brand: a.brand, state: codex } : a,
            )}
          />
        </div>
      </Panel>
      <div className={s.agentsTask} data-wire-to="">
        <WorkCard
          {...TASK}
          status={TaskStatus.Running}
          steps={STEPS}
          at={1}
          elapsed="4m"
          lead={OPUS}
          onStep={[GPT, GEMINI]}
          note="two labs reviewing one change"
        />
      </div>
      {wired && <Wires rootRef={root} from={['Claude Code', 'Codex', 'Gemini CLI']} to="[data-wire-to]" />}
      {notes > 0 && <Note target="Gemini CLI" side="bottom" from="far" reach={44} shift={30} label="Each signed in as you, on your plan" />}
      {notes > 1 && <Note target={TASK.title} side="top" reach={48} shift={30} label="One lab checks another" />}
      {pointer}
    </div>
  )
}

/* Lines from each agent to the task it works on. */
function Wires({ rootRef, from, to }: { rootRef: RefObject<HTMLDivElement | null>; from: readonly string[]; to: string }) {
  const [paths, setPaths] = useState<string[]>([])
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const k = el.getBoundingClientRect().width ? el.offsetWidth / el.getBoundingClientRect().width : 1
    const target = find(el, to)
    if (!target) return
    const t = rectIn(el, target, k)
    setPaths(
      from.flatMap((name, i) => {
        const a = find(el, name)
        if (!a) return []
        const r = rectIn(el, a, k)
        const x1 = r.x + r.w + 10
        const y1 = r.y + r.h / 2
        const x2 = t.x - 6
        const y2 = t.y + 30 + i * 22
        const mid = (x1 + x2) / 2
        return [`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`]
      }),
    )
  }, [rootRef, from, to])
  return (
    <svg className={s.wires} aria-hidden="true">
      {paths.map((d, i) => (
        <path key={d} d={d} pathLength={1} style={{ animationDelay: `${i * 140}ms` }} />
      ))}
    </svg>
  )
}

/** The tour, in its order: asking, the agents, the calls, the review. */
export const SCENES: ((p: SceneProps) => ReactNode)[] = [TaskScene, AgentsScene, CallsScene, ReviewScene]
