import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

import {
  ActionButton,
  Brand,
  BrandMark,
  Button,
  CountdownRing,
  LinkButton,
  LiveDot,
  Menu,
  MenuRadioGroup,
  MenuRadioItem,
  type ModelInfo,
  ModelPick,
  Segmented,
  Skeleton,
  TaskEnd,
  taskEndText,
  TaskLaunch,
  type LaunchPick,
  type LaunchStep,
  WorksIn,
} from '@althar/ui'

import { effortFor, model, useModelPrefs } from '../../../../packages/ui/src/fixtures/models'
import t from '../../../../packages/ui/src/coordinator/TaskLaunch/TaskLaunch.module.css'
import { type Draft, phaseWords, type Spec } from './timeline'
import s from './lab.module.css'

/*
 * Direction C, a team assembled, while the coordinator drafts a task: seats
 * for the lead and the reviewer fill, and the steps drop into their slots.
 * Three ways it becomes the plan once the plan is proposed:
 *
 *   C   swaps to the kit's plan card (TaskLaunch), a crossfade.
 *   C1  morphs into it: each seat travels into its step's model picker, each
 *       slot into its step, the card into the plan's shape (a view transition).
 *   C2  is the plan: the same card, its seats becoming the pickers, its slots
 *       the steps, and the countdown taking the foot.
 */

export interface DirectionProps {
  readonly draft: Draft
  /** Held while drafting: it won't start on its own once it's ready. */
  readonly held: boolean
  readonly onHold: (held: boolean) => void
}

export const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

export const leadLabel = (spec: Spec) => (spec.preset === 'Prototype' ? 'Prototype' : 'Implement')

export const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

/** The kit's plan card, once the plan is proposed. */
function Plan({ spec, held }: { spec: Spec; held: boolean }) {
  const [steps, setSteps] = useState<ReadonlyArray<LaunchStep>>(() => [
    { id: 'impl', label: leadLabel(spec), agents: [spec.lead], fixed: 'the lead' },
    ...(spec.review === null ? [] : [{ id: 'review', label: 'Review', agents: [spec.review], optional: true }]),
  ])
  const prefs = useModelPrefs()
  const picker = ({ step, agent, k, owner }: LaunchPick) => (
    <ModelPick
      variant="field"
      placement="below"
      owner={owner}
      model={agent}
      pinned={prefs.pinned}
      effort={step.id === 'impl' ? spec.leadEffort : effortFor(agent, prefs.efforts)}
      defaultEffort={effortFor(agent, prefs.efforts)}
      onChange={(id) =>
        setSteps(steps.map((st) => (st.id === step.id ? { ...st, agents: st.agents.map((a, i) => (i === k ? model(id) : a)) } : st)))
      }
      onEffort={() => {}}
    />
  )
  return (
    <TaskLaunch
      task={spec.slug}
      preset={spec.preset}
      title={spec.title}
      project="Althar"
      steps={steps}
      onStepsChange={setSteps}
      picker={picker}
      estimate={spec.estimate}
      wait={25}
      defaultHeld={held}
      worksIn={WorksIn.Worktree}
      {...(spec.onBranch ? { hideEnd: true } : { defaultEnd: TaskEnd.DraftPr })}
      onStart={() => {}}
    />
  )
}

/** What arrives fades in, dim to bright; it doesn't travel. */
export function Arrive({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.arrive, className)}>{children}</span>
}

/** Streamed words: the newest fade in, as a thread's do. */
export function Streamed({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span key={i} className={s.word}>
          {i > 0 && ' '}
          {word}
        </span>
      ))}
      <span className={s.caret} aria-hidden="true" />
    </>
  )
}

export const SHUFFLE = [Brand.Anthropic, Brand.OpenAI, Brand.Google, Brand.Alibaba, Brand.Moonshot] as const

/** A seat being filled: marks go round while it's chosen, then the one picked settles in. With `pick`, its model can be changed. */
function Seat({
  seat,
  picked,
  choosing,
  effort,
  pick,
  morph,
}: {
  seat: string
  picked: ModelInfo | null
  choosing: boolean
  effort?: string
  pick?: ReactNode
  morph: string
}) {
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    if (!choosing || picked !== null) return
    const id = window.setInterval(() => setTurn((n) => n + 1), 140)
    return () => window.clearInterval(id)
  }, [choosing, picked])
  return (
    <div
      className={cx(s.seat, picked !== null && s.seated, choosing && picked === null && s.choosing, pick !== undefined && s.live)}
      data-morph={morph}
    >
      <span className={s.avatar}>
        {picked?.mark !== undefined ? (
          <BrandMark brand={picked.mark} size={18} />
        ) : choosing ? (
          <BrandMark key={turn} brand={SHUFFLE[turn % SHUFFLE.length] ?? Brand.Anthropic} size={18} className={s.shuffle} />
        ) : null}
      </span>
      <span className={s.seatText}>
        <span className={s.role}>{seat}</span>
        {pick !== undefined ? (
          <span className={s.seatPick}>{pick}</span>
        ) : (
          <span className={s.seatName}>
            {picked !== null ? (
              <Arrive>
                {picked.short}
                {effort !== undefined && <span className={s.effort}> · {effort}</span>}
              </Arrive>
            ) : choosing ? (
              'Choosing…'
            ) : (
              <span className={s.empty}>Open seat</span>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

/** What C2's card holds once the plan is proposed: everything the plan card lets the person change. */
export interface Planned {
  readonly lead: ModelInfo
  readonly leadEffort: string | null
  readonly review: ModelInfo | null
  readonly reviewSkipped: boolean
  readonly end: TaskEnd
  readonly worksIn: WorksIn
  readonly left: number
  readonly started: boolean
  readonly set: (patch: Partial<Omit<Planned, 'set' | 'left' | 'started'>>) => void
  readonly start: () => void
}

/** The team card: assembling while drafted; with `planned`, the plan itself (C2). */
export function TeamCard({ draft, held, onHold, planned, body }: DirectionProps & { planned?: Planned; body?: ReactNode }) {
  const { spec } = draft
  const prefs = useModelPrefs()
  const live = planned !== undefined
  const steps = [
    { key: 'lead', label: leadLabel(spec), in: draft.lead },
    ...(spec.review === null ? [] : [{ key: 'review', label: 'Review', in: draft.review }]),
    { key: 'end', label: spec.onBranch ? 'Ends on its branch' : taskEndText[planned?.end ?? TaskEnd.DraftPr].short, in: draft.end },
  ]
  const picker = (who: 'lead' | 'review', chosen: ModelInfo, effort: string | null) =>
    planned && (
      <ModelPick
        variant="quiet"
        placement="below"
        owner={who === 'lead' ? 'Lead for this task' : 'Review'}
        model={chosen}
        pinned={prefs.pinned}
        effort={effort}
        defaultEffort={effortFor(chosen, prefs.efforts)}
        onChange={(id) => planned.set(who === 'lead' ? { lead: model(id) } : { review: model(id) })}
        onEffort={(level) => who === 'lead' && planned.set({ leadEffort: level })}
      />
    )
  return (
    <div className={cx(t.launch, s.drafting, held && t.held)} aria-busy={!live} data-morph="card">
      <div className={t.head}>
        <span className={t.kicker} data-morph="kicker">
          {draft.preset ? <Arrive>{spec.preset}</Arrive> : 'Putting a team together'}
        </span>
        <p className={cx(t.title, s.titleLine)} data-morph="title">
          {draft.titleDone ? (
            <Arrive>{spec.title}</Arrive>
          ) : draft.title === '' ? (
            <Skeleton width="58%" height={11} />
          ) : (
            <Streamed text={draft.title} />
          )}
        </p>
        {planned && (
          <div className={cx(t.where, s.arrive)}>
            <Segmented<WorksIn>
              label="Works in"
              value={planned.worksIn}
              onChange={(next) => planned.set({ worksIn: next })}
              options={[
                { value: WorksIn.Local, label: 'Local', tooltip: { label: 'One task at a time; your own edits share it.' } },
                { value: WorksIn.Worktree, label: 'Worktree', tooltip: { label: 'Side by side with other tasks. Builds from cold.' } },
              ]}
            />
          </div>
        )}
      </div>
      {body ?? (
        <>
          <div className={s.seats}>
            <Seat
              seat="Lead"
              morph="lead"
              picked={draft.lead ? (planned?.lead ?? spec.lead) : null}
              choosing={draft.size}
              effort={spec.leadEffort}
              {...(planned ? { pick: picker('lead', planned.lead, planned.leadEffort) } : {})}
            />
            {spec.review !== null && (
              <Seat
                seat="Reviewer"
                morph="review"
                picked={draft.review ? (planned?.review ?? spec.review) : null}
                choosing={draft.lead}
                {...(planned?.review
                  ? { pick: planned.reviewSkipped ? <span className={s.empty}>No review</span> : picker('review', planned.review, null) }
                  : {})}
              />
            )}
            <p className={s.sizeLine} data-morph="size">
              {draft.size ? <Arrive>{spec.size}</Arrive> : draft.briefDone ? null : <Arrive>Writing the brief…</Arrive>}
            </p>
          </div>
          <ol className={s.track}>
            {steps.map((step, i) => {
              const skipped = step.key === 'review' && planned?.reviewSkipped === true
              return (
                <li key={step.key} className={cx(s.slot, step.in && s.dropped, skipped && s.slotSkipped)} data-morph={`step-${step.key}`}>
                  <span className={s.slotN}>{i + 1}</span>
                  {planned && step.key === 'end' && !spec.onBranch ? (
                    <Menu
                      label="When the work is done"
                      width={320}
                      trigger={
                        <ActionButton size="small" trailingIcon="chevronD" className={s.slotPick}>
                          {step.label}
                        </ActionButton>
                      }
                    >
                      <MenuRadioGroup
                        label="When the work is done"
                        value={planned.end}
                        onChange={(v) => planned.set({ end: ENDS.find((x) => x === v) ?? planned.end })}
                      >
                        {ENDS.map((x) => (
                          <MenuRadioItem key={x} value={x} hint={taskEndText[x].note}>
                            {taskEndText[x].title}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </Menu>
                  ) : (
                    <span className={s.slotLabel}>{step.label}</span>
                  )}
                  {planned && step.key === 'review' && (
                    <LinkButton className={s.slotSkip} onClick={() => planned.set({ reviewSkipped: !planned.reviewSkipped })}>
                      {planned.reviewSkipped ? 'Add back' : 'Skip'}
                    </LinkButton>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
      <div className={t.foot} data-morph="foot">
        <span className={t.estimate}>{draft.estimate ? <Arrive>{spec.estimate}</Arrive> : null}</span>
        {planned ? (
          planned.started ? (
            <span className={t.when}>Starting…</span>
          ) : (
            <>
              {!held && <CountdownRing left={planned.left / 25} />}
              <span className={t.when}>{held ? 'Held' : `Starts in ${planned.left}s`}</span>
              {!held && (
                <Button variant="quiet" onClick={() => onHold(true)}>
                  Hold
                </Button>
              )}
              <Button onClick={planned.start}>{held ? 'Start' : 'Start now'}</Button>
              {!held && <i className={t.bar} style={{ ['--left' as string]: planned.left / 25 }} aria-hidden="true" />}
            </>
          )
        ) : held ? (
          <span className={t.when}>Held · starts when you say</span>
        ) : (
          <>
            <span className={cx(t.when, s.phase)}>
              <LiveDot />
              <Arrive key={draft.phase}>{phaseWords[draft.phase]}</Arrive>
            </span>
            <Button variant="quiet" onClick={() => onHold(true)}>
              Hold
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/* C, as before: the team card, then the kit's plan card in its place. */
export function Swap(props: DirectionProps) {
  return <div className={s.swap}>{props.draft.ready ? <Plan spec={props.draft.spec} held={props.held} /> : <TeamCard {...props} />}</div>
}

/**
 * Which part of the plan card each part of the team card becomes, found in
 * the plan card's own markup: the seats its pickers, the slots its steps.
 */
const PLAN_PARTS: ReadonlyArray<readonly [morph: string, find: (launch: Element) => Element | null | undefined]> = [
  ['card', (launch) => launch],
  ['kicker', (launch) => launch.firstElementChild?.firstElementChild],
  ['title', (launch) => launch.querySelector('p[title]')],
  ['lead', (launch) => launch.querySelector('ol > li:nth-child(1) button')],
  ['review', (launch) => launch.querySelector('ol > li:nth-child(2):not(:last-child) button')],
  ['step-lead', (launch) => launch.querySelector('ol > li:nth-child(1) > span:nth-child(2)')],
  ['step-review', (launch) => launch.querySelector('ol > li:nth-child(2):not(:last-child) > span:nth-child(2)')],
  ['step-end', (launch) => launch.querySelector('ol > li:last-child > :nth-child(2)')],
  ['foot', (launch) => launch.lastElementChild],
]

const named = (root: HTMLElement, slug: string, side: 'old' | 'new') => {
  const launch = root.firstElementChild
  for (const [morph, find] of PLAN_PARTS) {
    const el = side === 'old' ? root.querySelector(`[data-morph="${morph}"]`) : launch && find(launch)
    if (el instanceof HTMLElement) el.style.viewTransitionName = `m${slug}-${morph}`
  }
}
const unnamed = (root: HTMLElement) => root.querySelectorAll<HTMLElement>('*').forEach((el) => (el.style.viewTransitionName = ''))

/* C1. Morph: the team card becomes the plan card in one motion, each part travelling to where it lives there. */
export function Morph(props: DirectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const { ready, spec } = { ready: props.draft.ready, spec: props.draft.spec }
  useLayoutEffect(() => {
    const root = ref.current
    if (!ready || shown || root === null) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still || document.startViewTransition === undefined) {
      setShown(true)
      return
    }
    named(root, spec.slug, 'old')
    const morph = document.startViewTransition(() => {
      unnamed(root)
      flushSync(() => setShown(true))
      named(root, spec.slug, 'new')
    })
    void morph.finished.finally(() => unnamed(root))
  }, [ready, shown, spec.slug])
  return (
    <div ref={ref} className={s.morph}>
      {shown ? <Plan spec={spec} held={props.held} /> : <TeamCard {...props} />}
    </div>
  )
}

/* C2. One card: the team card is the plan; once proposed its seats are the pickers, and the countdown takes the foot. */
/** C2's plan, once proposed: what the person can change, and its countdown; nothing while it drafts. */
export function usePlanned(props: DirectionProps): Planned | undefined {
  const { spec, ready } = props.draft
  const [plan, setPlan] = useState({
    lead: spec.lead,
    leadEffort: spec.leadEffort as string | null,
    review: spec.review,
    reviewSkipped: false,
    end: TaskEnd.DraftPr,
    worksIn: WorksIn.Worktree,
  })
  const [left, setLeft] = useState(25)
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (!ready || props.held || started) return
    const id = window.setTimeout(() => (left <= 1 ? setStarted(true) : setLeft(left - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [ready, props.held, started, left])
  const planned: Planned | undefined = ready
    ? {
        ...plan,
        left,
        started,
        set: (patch) => setPlan((now) => ({ ...now, ...patch })),
        start: () => {
          props.onHold(false)
          setStarted(true)
        },
      }
    : undefined
  return planned
}

export function OneCard(props: DirectionProps) {
  const planned = usePlanned(props)
  return <TeamCard {...props} {...(planned ? { planned } : {})} />
}
