import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { PullChip } from '../../board/BoardCard/Chips'
import { TaskCard } from '../../coordinator/TaskCard/TaskCard'
import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { FindingState, StepState, TaskStatus, ToolState, Verdict } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ReviewSealGlyph } from '../../setup/ReviewSeal/ReviewSeal'
import { Review, type ReviewFinding } from '../../thread/Review/Review'
import { StepGraph } from '../../thread/StepGraph/StepGraph'
import { You } from '../../thread/You/You'
import {
  ASKED,
  DOING,
  FINDINGS,
  FIX,
  GPT,
  HAS,
  LANES,
  LOOP,
  OPUS,
  PROJECT,
  REPLY,
  REPOSITORIES,
  REVIEWING,
  SEAL,
  SEALED,
  SET_ASIDE,
  STEPS,
  TASK,
  TASKS,
} from './demo'
import { useScene } from './Station'
import s from './scenes.module.css'

/*
 * The tour's scenes. Each is made of the real components, holding the demo
 * project's state, with a script that changes that state the way Althar
 * would. Each is drawn at its real size and fits the card's room as it is,
 * made smaller only where the window is small; nothing is pinned outside
 * one, so nothing needs room round it. `end` is where the script finishes,
 * so leaving a scene early, or arriving with no motion, shows the same final
 * picture.
 */

export interface SceneProps {
  live: boolean
  instant: boolean
}

const GITHUB = { name: 'GitHub', brand: Brand.GitHub }

/* ---- work happens in projects: repositories into it, tasks out of it -------- */

export function ProjectScene({ live, instant }: SceneProps) {
  const [shown, setShown] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  useScene(
    live,
    instant,
    async (stage) => {
      for (const i of [1, 2, 3] as const) {
        await stage.wait(i === 1 ? 500 : 1100)
        setShown(i)
      }
    },
    () => setShown(3),
  )
  const piece = (n: number) => cx(s.piece, shown >= n && s.pieceOn)
  return (
    <div ref={root} className={s.project}>
      <ul className={s.column}>
        {REPOSITORIES.map((r) => (
          <li key={r.name} className={cx(s.small, piece(1))} data-into="">
            <span className={s.smallHead}>
              <BrandMark brand={Brand.GitHub} size={14} />
              <span className={s.smallName}>{r.name}</span>
              <span className={s.role}>{r.role}</span>
            </span>
            <code className={s.mono}>{r.where}</code>
          </li>
        ))}
      </ul>
      <div className={cx(s.hub, piece(2))} data-hub="">
        <span className={s.hubName}>
          <ProjectMark seed={PROJECT.seed} ink={PROJECT.ink} size={28} />
          {PROJECT.name}
        </span>
        <ul className={s.has}>
          {HAS.map((h) => (
            <li key={h.name}>
              <Icon name={h.icon} size={13} />
              {h.name}
            </li>
          ))}
        </ul>
      </div>
      <ul className={s.column}>
        {TASKS.map((x) => (
          <li key={x.task} className={cx(s.small, piece(3))} data-out="">
            <span className={s.smallHead}>
              <span className={s.taskNo}>{x.task}</span>
              <span className={s.smallName}>{x.title}</span>
            </span>
            <span className={s.branch}>
              <Icon name="branch" size={12} />
              <code className={s.mono}>{x.branch}</code>
            </span>
          </li>
        ))}
      </ul>
      <Links rootRef={root} into={shown >= 2} out={shown >= 3} instant={instant} />
    </div>
  )
}

/** Where an element sits in the scene by layout alone, so the scale the card gives the scene doesn't move it. */
const placeIn = (root: HTMLElement, el: HTMLElement) => {
  let x = 0
  let y = 0
  for (let n: HTMLElement | null = el; n !== null && n !== root; n = n.offsetParent instanceof HTMLElement ? n.offsetParent : null) {
    x += n.offsetLeft
    y += n.offsetTop
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

/** The lines: each repository into the project, from edge to edge, and the project out to each task. */
function Links({
  rootRef,
  into,
  out,
  instant,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  into: boolean
  out: boolean
  instant: boolean
}) {
  const [paths, setPaths] = useState<{ into: string[]; out: string[] }>({ into: [], out: [] })
  useLayoutEffect(() => {
    const el = rootRef.current
    const hub = el?.querySelector<HTMLElement>('[data-hub]')
    if (!el || !hub) return
    const h = placeIn(el, hub)
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mid = (x1 + x2) / 2
      return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
    }
    /* where on the project's side each line meets it: spread round its middle */
    const at = (i: number, n: number) => h.y + h.h / 2 + (i - (n - 1) / 2) * 14
    const from = Array.from(el.querySelectorAll<HTMLElement>('[data-into]'), (n) => placeIn(el, n))
    const to = Array.from(el.querySelectorAll<HTMLElement>('[data-out]'), (n) => placeIn(el, n))
    setPaths({
      into: from.map((r, i) => curve(r.x + r.w, r.y + r.h / 2, h.x, at(i, from.length))),
      out: to.map((r, i) => curve(h.x + h.w, at(i, to.length), r.x, r.y + r.h / 2)),
    })
  }, [rootRef, into, out])
  return (
    <svg className={cx(s.links, instant && s.still)} aria-hidden="true">
      {into && paths.into.map((d, i) => <path key={d} d={d} pathLength={1} style={{ animationDelay: `${i * 90}ms` }} />)}
      {out && paths.out.map((d, i) => <path key={d} d={d} pathLength={1} style={{ animationDelay: `${i * 90}ms` }} />)}
    </svg>
  )
}

/* ---- meet the coordinator: what you asked, its plan, the task it starts ----- */

export function CoordinatorScene({ live, instant }: SceneProps) {
  const [shown, setShown] = useState(0)
  const [at, setAt] = useState(0)
  useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(900)
      setShown(1)
      await stage.wait(1500)
      setShown(2)
      for (const i of [1, 2, 3]) {
        await stage.wait(1100)
        setAt(i)
      }
    },
    () => {
      setShown(2)
      setAt(1)
    },
  )
  return (
    <div className={s.coordinator}>
      <div className={s.threadHead}>
        <Icon name="agents" size={13} />
        Coordinator
      </div>
      <div className={s.thread}>
        <You at="now">{ASKED.said}</You>
        <p className={s.reply}>
          {shown > 0 &&
            REPLY.split(' ').map((word, i) => (
              <span key={i} className={cx(!instant && s.word)} style={{ animationDelay: `${i * 28}ms` }}>
                {word}{' '}
              </span>
            ))}
        </p>
        {/* Its room is held from the start, so the thread doesn't grow as the task arrives. */}
        <div className={cx(shown > 1 && !instant && s.enter)} style={{ visibility: shown > 1 ? 'visible' : 'hidden' }}>
          <TaskCard
            {...TASK}
            status={TaskStatus.Running}
            steps={STEPS}
            at={at}
            now={DOING[at]}
            started="just now"
            lead={OPUS}
            fresh={shown > 1 && !instant}
          />
        </div>
      </div>
    </div>
  )
}

/* ---- agents from different makers: one leads, another's reviews ------------- */

export function MakersScene({ live, instant }: SceneProps) {
  const [beat, setBeat] = useState(0)
  useScene(
    live,
    instant,
    async (stage) => {
      for (const i of [1, 2, 3] as const) {
        await stage.wait(1500)
        setBeat(i)
      }
    },
    () => setBeat(LOOP.length - 1),
  )
  return (
    <div className={s.makers}>
      <StepGraph lanes={LANES} rounds={[ASKED]} steps={LOOP[beat] ?? []} className={s.graph} />
    </div>
  )
}

/* ---- reviewed before you see it -------------------------------------------- */

/* The review as the lead settles it: one finding fixed in the second round, one set aside with its reason. */
const settled = (finding: ReviewFinding): ReviewFinding =>
  finding.id === FIX ? { ...finding, state: FindingState.Fixed, round: 2 } : { ...finding, state: FindingState.Aside, reason: SET_ASIDE }

export function ReviewScene({ live, instant }: SceneProps) {
  const [read, setRead] = useState(false)
  const [findings, setFindings] = useState(FINDINGS)
  const [sealed, setSealed] = useState(false)
  useScene(
    live,
    instant,
    async (stage) => {
      await stage.wait(1400)
      setRead(true)
      await stage.wait(1500)
      setFindings((now) => now.map((f) => (f.id === FIX ? settled(f) : f)))
      await stage.wait(900)
      setFindings((now) => now.map(settled))
      await stage.wait(1100)
      setSealed(true)
    },
    () => {
      setRead(true)
      setFindings(FINDINGS.map(settled))
      setSealed(true)
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
        <ReviewSealGlyph facts={SEAL} size={44} />
      </div>
    </div>
  )
}
