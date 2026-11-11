import type { ReactNode } from 'react'

import { Button, Field, HoverCard, Icon, LinkButton, Model, type ModelInfo, TaskEnd, TaskLaunch, WorksIn } from '@althar/ui'

import { MODEL_LIST } from '../../../../packages/ui/src/fixtures/models'
import { cx } from '../../../../packages/ui/src/lib/cx'
import type { PresetParts } from './runtime'
import type { Verdict } from './rules'
import s from './page.module.css'

/*
 * The offer on the plan card it came with, four ways: a strip inside the
 * card, under its foot (TaskLaunch's `aside`), since the card already shows
 * the parts. Each says what parts and presets are behind an info mark. A
 * verdict of `near` is the same strip naming the built-in preset that fits.
 * The first round's card, line and picker are in git history (fb4fcc43c).
 */

export type OfferState = 'offer' | 'editing' | 'kept' | 'dismissed'
export type Shown = Extract<Verdict, { kind: 'offer' | 'near' }>

const base = (id: string) => MODEL_LIST.find((one) => one.id === id) ?? MODEL_LIST[0]!
const MODELS: Readonly<Record<string, ModelInfo>> = {
  'claude-code/claude-opus-5-5': { ...base('claude-opus-5'), id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5' },
  'claude-code/claude-sonnet-5-5': { ...base('claude-sonnet-5'), id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5' },
  'codex/gpt-6.1-sol': { ...base('gpt-5.2-codex'), id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', short: 'Sol' },
}
const modelOf = (lead: string | null) => (lead === null ? null : (MODELS[lead] ?? null))

/** What parts and presets are, behind the info mark. */
function About() {
  return (
    <HoverCard
      width={300}
      placement="above"
      card={
        <span className={s.about}>
          <span>
            <b>Parts</b> are how a task runs: where it works, who checks it, how it ends, and who leads it. This card shows them.
          </span>
          <span>
            <b>A preset</b> is a named set of parts a new task starts from, like Change or Prototype. Changing a task’s parts later never
            changes its preset. Yours are in Settings › Presets.
          </span>
        </span>
      }
    >
      <button type="button" className={s.info} aria-label="What are parts and presets?">
        <Icon name="info" size={13} />
      </button>
    </HoverCard>
  )
}

/** The plan card the offer came with, from the kit: its preset in the kicker, its steps, how it ends; the offer inside it. */
export function PlanCard({ title, parts, preset, aside }: { title: string; parts: PresetParts; preset: string; aside?: ReactNode }) {
  const lead = modelOf(parts.lead) ?? MODELS['claude-code/claude-opus-5-5']!
  const reviewer = modelOf(parts.reviewer) ?? MODELS['codex/gpt-6.1-sol']!
  return (
    <TaskLaunch
      task="812"
      preset={preset}
      title={title}
      project="althar"
      estimate="About 20 min"
      steps={[
        { id: 'impl', label: 'Implement', agents: [lead], fixed: 'the lead' },
        { id: 'review', label: 'Review', agents: [reviewer], optional: true, skipped: parts.checked === 'none' },
      ]}
      picker={({ agent }) => <Model model={agent} short />}
      end={parts.end === 'ready' ? TaskEnd.ReadyPr : parts.end === 'draft' ? TaskEnd.DraftPr : TaskEnd.PushOnly}
      worksIn={parts.workspace === 'local' ? WorksIn.Local : WorksIn.Worktree}
      held
      onStart={() => {}}
      {...(aside === undefined ? {} : { aside })}
    />
  )
}

export interface OfferProps {
  verdict: Shown
  state: OfferState
  setState: (state: OfferState) => void
  name: string
  setName: (name: string) => void
  planPreset: string
}

export interface Direction {
  key: string
  letter: string
  name: string
  idea: string
  /** The plan card with the offer in it. */
  Thread: (props: OfferProps & { title: string; planParts: PresetParts }) => ReactNode
}

/** The name, editable in place: a Field while editing, its text with a pencil otherwise. */
function NameInPlace({
  name,
  setName,
  editing,
  setEditing,
}: {
  name: string
  setName: (n: string) => void
  editing: boolean
  setEditing: (e: boolean) => void
}) {
  if (editing)
    return (
      <Field
        aria-label="Preset name"
        className={s.nameField}
        value={name}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens from a press on the name, to type in at once
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') setEditing(false)
        }}
      />
    )
  return (
    <button type="button" className={s.name} onClick={() => setEditing(true)} aria-label={`${name}, rename`}>
      {name}
      <Icon name="pencil" size={10} />
    </button>
  )
}

const nearWhat = (v: Extract<Verdict, { kind: 'near' }>) => `These are ${v.preset.name}, ${v.differs}.`

/** Closes the strip: Not now. */
const Cross = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className={s.cross} aria-label="Not now" onClick={onClick}>
    <Icon name="close" size={10} />
  </button>
)

/** Kept, the strip says so in its place, with Undo; the card's kicker has the new name. */
function Kept({ verdict, name, setState, tone }: Pick<OfferProps, 'verdict' | 'name' | 'setState'> & { tone?: string }) {
  return (
    <div className={cx(s.strip, tone, s.done)}>
      <Icon name="check" size={11} />
      <span>{verdict.kind === 'near' ? `Tasks like these start from ${verdict.preset.name}` : `Kept as a preset: ${name}`}</span>
      <span className={s.grow} />
      <LinkButton onClick={() => setState('offer')}>Undo</LinkButton>
    </div>
  )
}

const editingOf = (setState: OfferProps['setState']) => (editing: boolean) => setState(editing ? 'editing' : 'offer')

/* A · Hairline: a quiet row under the foot, the name in place, Keep and a cross. */
function Hairline({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} />
  return (
    <div className={s.strip}>
      {verdict.kind === 'near' ? (
        <span className={s.text}>{nearWhat(verdict)}</span>
      ) : (
        <>
          <span className={s.text}>Keep these parts as</span>
          <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={editingOf(setState)} />
        </>
      )}
      <About />
      <span className={s.grow} />
      <Button size="small" onClick={() => setState('kept')}>
        {verdict.kind === 'near' ? `Use ${verdict.preset.name}` : 'Keep'}
      </Button>
      <Cross onClick={() => setState('dismissed')} />
    </div>
  )
}

/* B · Violet: the same row on the kit's ask paper, so it reads as a question with a primary answer. */
function Violet({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} tone={s.violet} />
  return (
    <div className={cx(s.strip, s.violet)}>
      {verdict.kind === 'near' ? (
        <span className={s.text}>{nearWhat(verdict)}</span>
      ) : (
        <>
          <span className={s.text}>Third time with these parts. Keep them as</span>
          <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={editingOf(setState)} />
        </>
      )}
      <About />
      <span className={s.grow} />
      <Button size="small" variant="quiet" onClick={() => setState('dismissed')}>
        Not now
      </Button>
      <Button size="small" variant="signal" onClick={() => setState('kept')}>
        {verdict.kind === 'near' ? `Use ${verdict.preset.name}` : 'Keep'}
      </Button>
    </div>
  )
}

/* C · Field: the name is a field from the start, labelled as a preset's name; Save beside it. */
function NameField(props: OfferProps) {
  const { verdict, state, setState, name, setName } = props
  if (verdict.kind === 'near') return <Hairline {...props} />
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} />
  return (
    <div className={s.strip}>
      <label className={s.text} htmlFor="preset-name">
        Save as a preset
      </label>
      <About />
      <Field
        id="preset-name"
        className={s.wideField}
        value={name}
        onFocus={() => setState('editing')}
        onChange={(event) => setName(event.target.value)}
      />
      <span className={s.grow} />
      <Button size="small" disabled={name.trim() === ''} onClick={() => setState('kept')}>
        Save
      </Button>
      <Cross onClick={() => setState('dismissed')} />
    </div>
  )
}

/* D · Start from: says what keeping it changes, the preset these tasks start from instead of the plan's; the kicker follows. */
function From({ verdict, state, setState, name, setName, planPreset }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} />
  return (
    <div className={s.strip}>
      <span className={s.text}>Start tasks like this from</span>
      {verdict.kind === 'near' ? (
        <b className={s.named}>{verdict.preset.name}</b>
      ) : (
        <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={editingOf(setState)} />
      )}
      <span className={s.was}>
        not <s>{planPreset}</s>
      </span>
      <About />
      <span className={s.grow} />
      <LinkButton onClick={() => setState('dismissed')}>Not now</LinkButton>
      <Button size="small" onClick={() => setState('kept')}>
        {verdict.kind === 'near' ? 'Use it' : 'Keep'}
      </Button>
    </div>
  )
}

const onCard = (Offer: (props: OfferProps) => ReactNode) =>
  function Thread({ title, planParts, ...props }: OfferProps & { title: string; planParts: PresetParts }) {
    const preset = props.state === 'kept' ? (props.verdict.kind === 'near' ? props.verdict.preset.name : props.name) : props.planPreset
    return <PlanCard title={title} parts={planParts} preset={preset} aside={<Offer {...props} />} />
  }

export const DIRECTIONS: ReadonlyArray<Direction> = [
  {
    key: 'c1',
    letter: 'A',
    name: 'Hairline',
    idea: 'A quiet row inside the card, under its foot: the name in place, an info mark, Keep and a cross.',
    Thread: onCard(Hairline),
  },
  {
    key: 'c2',
    letter: 'B',
    name: 'Violet',
    idea: 'The same row on the kit’s ask paper, with Not now and a violet Keep: it reads as a question.',
    Thread: onCard(Violet),
  },
  {
    key: 'c3',
    letter: 'C',
    name: 'Field',
    idea: 'The name is a field from the start, labelled Save as a preset, with Save beside it.',
    Thread: onCard(NameField),
  },
  {
    key: 'c4',
    letter: 'D',
    name: 'Start from',
    idea: 'Says what keeping it changes: tasks like this start from it, not from the plan’s preset. The kicker follows.',
    Thread: onCard(From),
  },
]
