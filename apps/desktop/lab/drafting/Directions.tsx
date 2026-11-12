import { useEffect, useState, type ReactNode } from 'react'

import {
  Brand,
  BrandMark,
  Button,
  LiveDot,
  Model,
  type ModelInfo,
  ModelPick,
  Skeleton,
  TaskEnd,
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
 * Four ways a task's card shows while the coordinator drafts it. Each is
 * there from draft_task's first token and fills in as the parts arrive; once
 * the plan is proposed, each becomes the real plan card (TaskLaunch), counting
 * down. The drafting card is drawn with TaskLaunch's own styles, so it lands
 * where the plan will be, and the swap doesn't move anything.
 */

export interface DirectionProps {
  readonly draft: Draft
  /** Held while drafting: it won't start on its own once it's ready. */
  readonly held: boolean
  readonly onHold: () => void
}

const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

const leadLabel = (spec: Spec) => (spec.preset === 'Prototype' ? 'Prototype' : 'Implement')

/** The real plan card, once the plan is proposed: what every direction becomes. */
export function Plan({ spec, held }: { spec: Spec; held: boolean }) {
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

/** A model as the plan's picker shows it, before it can be changed. */
function Chosen({ model: chosen, effort }: { model: ModelInfo; effort?: string }) {
  return (
    <span className={cx(t.pick, s.chosen)}>
      <Model model={chosen} short />
      {effort !== undefined && <span className={s.effort}>{effort}</span>}
    </span>
  )
}

/** The foot while drafting: what it's doing, and Hold, so it never starts unseen. */
function Foot({ draft, held, onHold, words = true, estimate }: DirectionProps & { words?: boolean; estimate?: ReactNode }) {
  return (
    <div className={t.foot}>
      <span className={t.estimate}>{estimate ?? (draft.estimate ? <Arrive>{draft.spec.estimate}</Arrive> : null)}</span>
      {held ? (
        <span className={t.when}>Held · starts when you say</span>
      ) : (
        <>
          <span className={cx(t.when, s.phase)}>
            <LiveDot />
            {words ? <Arrive key={draft.phase}>{phaseWords[draft.phase]}</Arrive> : 'Drafting'}
          </span>
          <Button variant="quiet" onClick={onHold}>
            Hold
          </Button>
        </>
      )}
    </div>
  )
}

/** What arrives fades in, dim to bright; it doesn't travel. */
function Arrive({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.arrive, className)}>{children}</span>
}

/* A. Quiet: the plan's own shape, in shade, each part replacing its place as it's known. */
export function Quiet({ draft, held, onHold }: DirectionProps) {
  const { spec } = draft
  const twoRows = spec.review !== null || !draft.size
  return (
    <div className={cx(t.launch, s.drafting)} aria-busy="true">
      <div className={t.head}>
        <span className={cx(t.kicker, s.kickerLine)}>{draft.preset ? <Arrive>{spec.preset}</Arrive> : <Skeleton width="56px" />}</span>
        <p className={cx(t.title, s.titleLine)}>{draft.titleDone ? <Arrive>{spec.title}</Arrive> : <Skeleton width="58%" height={11} />}</p>
      </div>
      <ol className={t.steps}>
        <li className={t.step}>
          <span className={t.n}>1</span>
          {draft.lead ? <Arrive className={t.label}>{leadLabel(spec)}</Arrive> : <Skeleton width="72px" />}
          <span className={t.who}>
            {draft.lead ? <Chosen model={spec.lead} effort={spec.leadEffort} /> : <Skeleton width="120px" height={18} />}
          </span>
        </li>
        {twoRows && (
          <li className={t.step}>
            <span className={t.n}>2</span>
            {draft.review && spec.review ? <Arrive className={t.label}>Review</Arrive> : <Skeleton width="56px" />}
            <span className={t.who}>
              {draft.review && spec.review ? <Chosen model={spec.review} /> : <Skeleton width="96px" height={18} />}
            </span>
          </li>
        )}
        {!spec.onBranch && (
          <li className={cx(t.step, t.end)}>
            <span className={t.n}>{twoRows ? 3 : 2}</span>
            {draft.end ? (
              <Arrive>
                <span className={cx(t.pick, s.chosen)}>Open a draft PR</span>
              </Arrive>
            ) : (
              <Skeleton width="130px" height={18} />
            )}
          </li>
        )}
      </ol>
      <Foot draft={draft} held={held} onHold={onHold} words={false} estimate={draft.estimate ? undefined : <Skeleton width="44%" />} />
    </div>
  )
}

/* B. Written as it goes: the title and brief stream in as the coordinator writes them; each step arrives as it's chosen. */
export function Written({ draft, held, onHold }: DirectionProps) {
  const { spec } = draft
  return (
    <div className={cx(t.launch, s.drafting)} aria-busy="true">
      <div className={t.head}>
        <span className={t.kicker}>{draft.preset ? <Arrive>{spec.preset}</Arrive> : 'New task'}</span>
        <p className={cx(t.title, s.titleLine)}>
          {draft.title === '' ? <span className={s.waiting}>…</span> : <Streamed text={draft.title} done={draft.titleDone} />}
        </p>
        <div className={cx(s.brief, draft.briefDone && draft.size && s.briefGone)}>
          <p>
            <Streamed text={draft.brief} done={draft.briefDone} />
          </p>
        </div>
      </div>
      <ol className={t.steps}>
        {draft.lead && (
          <li className={cx(t.step, s.enter)}>
            <span className={t.n}>1</span>
            <span className={t.label}>{leadLabel(spec)}</span>
            <span className={t.who}>
              <Chosen model={spec.lead} effort={spec.leadEffort} />
            </span>
            <span className={t.why}>{spec.size}</span>
          </li>
        )}
        {draft.review && spec.review && (
          <li className={cx(t.step, s.enter)}>
            <span className={t.n}>2</span>
            <span className={t.label}>Review</span>
            <span className={t.who}>
              <Chosen model={spec.review} />
            </span>
          </li>
        )}
        {draft.end && !spec.onBranch && (
          <li className={cx(t.step, t.end, s.enter)}>
            <span className={t.n}>{spec.review ? 3 : 2}</span>
            <span className={cx(t.pick, s.chosen)}>Open a draft PR</span>
          </li>
        )}
      </ol>
      <Foot draft={draft} held={held} onHold={onHold} />
    </div>
  )
}

/** Streamed words: the newest fade in, as a thread's do. */
function Streamed({ text, done }: { text: string; done: boolean }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className={s.word}>
          {i > 0 && ' '}
          {word}
        </span>
      ))}
      {!done && text !== '' && <span className={s.caret} aria-hidden="true" />}
    </>
  )
}

const SHUFFLE = [Brand.Anthropic, Brand.OpenAI, Brand.Google, Brand.Alibaba, Brand.Moonshot] as const

/** A seat being filled: marks go round while it's chosen, then the one picked settles in. */
function Seat({ seat, picked, choosing, effort }: { seat: string; picked: ModelInfo | null; choosing: boolean; effort?: string }) {
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    if (!choosing || picked !== null) return
    const id = window.setInterval(() => setTurn((n) => n + 1), 140)
    return () => window.clearInterval(id)
  }, [choosing, picked])
  return (
    <div className={cx(s.seat, picked !== null && s.seated, choosing && picked === null && s.choosing)}>
      <span className={s.avatar}>
        {picked?.mark !== undefined ? (
          <BrandMark brand={picked.mark} size={18} />
        ) : choosing ? (
          <BrandMark key={turn} brand={SHUFFLE[turn % SHUFFLE.length] ?? Brand.Anthropic} size={18} className={s.shuffle} />
        ) : null}
      </span>
      <span className={s.seatText}>
        <span className={s.role}>{seat}</span>
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
      </span>
    </div>
  )
}

/* C. A team assembled: seats for the lead and the reviewer fill, and the steps drop into place. */
export function Team({ draft, held, onHold }: DirectionProps) {
  const { spec } = draft
  const steps = [
    { key: 'lead', label: leadLabel(spec), in: draft.lead },
    ...(spec.review === null ? [] : [{ key: 'review', label: 'Review', in: draft.review }]),
    { key: 'end', label: spec.onBranch ? 'Ends on its branch' : 'Draft PR', in: draft.end },
  ]
  return (
    <div className={cx(t.launch, s.drafting)} aria-busy="true">
      <div className={t.head}>
        <span className={t.kicker}>{draft.preset ? <Arrive>{spec.preset}</Arrive> : 'Putting a team together'}</span>
        <p className={cx(t.title, s.titleLine)}>
          {draft.titleDone ? (
            <Arrive>{spec.title}</Arrive>
          ) : draft.title === '' ? (
            <Skeleton width="58%" height={11} />
          ) : (
            <Streamed text={draft.title} done={false} />
          )}
        </p>
      </div>
      <div className={s.seats}>
        <Seat seat="Lead" picked={draft.lead ? spec.lead : null} choosing={draft.size} effort={spec.leadEffort} />
        {spec.review !== null && <Seat seat="Reviewer" picked={draft.review ? spec.review : null} choosing={draft.lead} />}
        <p className={s.sizeLine}>
          {draft.size ? <Arrive>{spec.size}</Arrive> : draft.briefDone ? null : <Arrive>Writing the brief…</Arrive>}
        </p>
      </div>
      <ol className={s.track}>
        {steps.map((step, i) => (
          <li key={step.key} className={cx(s.slot, step.in && s.dropped)}>
            <span className={s.slotN}>{i + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>
      <Foot draft={draft} held={held} onHold={onHold} />
    </div>
  )
}

/* D. A line first: one quiet line in the thread while it's drafted, opening into the plan once it's proposed. */
export function Line({ draft, held, onHold }: DirectionProps) {
  const { spec } = draft
  return (
    <div className={cx(s.line, held && s.lineHeld)} aria-busy="true">
      <span className={s.pips} aria-hidden="true">
        <i className={draft.lead ? s.pipOn : undefined} />
        <i className={draft.review || (draft.end && spec.review === null) ? s.pipOn : undefined} />
        <i className={draft.end ? s.pipOn : undefined} />
      </span>
      <span className={s.lineTitle}>{draft.titleDone ? <Arrive>{spec.title}</Arrive> : <b>Drafting a task</b>}</span>
      <span className={s.lineNow}>
        {held ? (
          'Held'
        ) : (
          <>
            {draft.lead && (
              <Arrive className={s.lineLead}>
                <Model model={spec.lead} short /> leads
              </Arrive>
            )}
            <span className={s.lineWhat}>
              <Arrive key={draft.phase}>{draft.lead ? '' : phaseWords[draft.phase]}</Arrive>
            </span>
          </>
        )}
      </span>
      {!held && (
        <Button variant="quiet" size="small" onClick={onHold}>
          Hold
        </Button>
      )}
    </div>
  )
}

export const directions = [
  { key: 'a', label: 'Quiet', Card: Quiet },
  { key: 'b', label: 'Written as it goes', Card: Written },
  { key: 'c', label: 'Team assembling', Card: Team },
  { key: 'd', label: 'A line first', Card: Line },
] as const
