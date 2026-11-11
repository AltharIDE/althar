import type { ReactNode } from 'react'

import { Button, Field, HoverCard, Icon, LinkButton, Model, type ModelInfo, Popover, TaskEnd, TaskLaunch, WorksIn } from '@althar/ui'

import { MODEL_LIST } from '../../../../packages/ui/src/fixtures/models'
import { cx } from '../../../../packages/ui/src/lib/cx'
import type { PresetParts } from './runtime'
import type { Verdict } from './rules'
import s from './page.module.css'

/*
 * The offer on the plan card it came with, as a secondary action: nothing in
 * it is a filled button, Start stays the one thing that stands out. Four
 * ways: a muted footnote row under the foot (TaskLaunch's `aside`), a link in
 * the foot itself (`footNote`) that opens a small popover, a caption under
 * the card, and a single icon in the foot. Each says what parts and presets
 * are behind an info mark. A verdict of `near` names the built-in preset
 * that fits. Earlier rounds are in git history: the card, line and picker
 * (fb4fcc43c), the louder strips (43aad191e).
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
export function PlanCard({
  title,
  parts,
  preset,
  aside,
  footNote,
}: {
  title: string
  parts: PresetParts
  preset: string
  aside?: ReactNode
  footNote?: ReactNode
}) {
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
      {...(footNote === undefined ? {} : { footNote })}
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
  /** The plan card with the offer on it. */
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
const editingOf = (setState: OfferProps['setState']) => (editing: boolean) => setState(editing ? 'editing' : 'offer')
const keepLabel = (verdict: Shown) => (verdict.kind === 'near' ? `Use ${verdict.preset.name}` : 'Keep')
const keptLine = (verdict: Shown, name: string) =>
  verdict.kind === 'near' ? `Tasks like these start from ${verdict.preset.name}` : `Kept as ${name}`

/** Kept, a muted line in the offer's place, with Undo. */
function Kept({ verdict, name, setState, className }: Pick<OfferProps, 'verdict' | 'name' | 'setState'> & { className?: string }) {
  return (
    <span className={cx(s.quiet, className)}>
      <Icon name="check" size={10} />
      {keptLine(verdict, name)}
      <LinkButton onClick={() => setState('offer')}>Undo</LinkButton>
    </span>
  )
}

/* A · Footnote: the bottom bar, demoted: small muted words under the foot, Keep and Not now as links. */
function Footnote({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  return (
    <div className={s.footnote}>
      {state === 'kept' ? (
        <Kept verdict={verdict} name={name} setState={setState} />
      ) : (
        <span className={s.quiet}>
          {verdict.kind === 'near' ? (
            nearWhat(verdict)
          ) : (
            <>
              Keep these parts as
              <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={editingOf(setState)} />
            </>
          )}
          <About />
          <span className={s.grow} />
          <LinkButton onClick={() => setState('dismissed')}>Not now</LinkButton>
          <LinkButton className={s.strong} onClick={() => setState('kept')}>
            {keepLabel(verdict)}
          </LinkButton>
        </span>
      )}
    </div>
  )
}

/** The small form a foot link or icon opens: the name, what it is, Keep. */
function KeepForm({ verdict, setState, name, setName }: Pick<OfferProps, 'verdict' | 'setState' | 'name' | 'setName'>) {
  return (
    <form
      className={s.form}
      onSubmit={(event) => {
        event.preventDefault()
        setState('kept')
      }}
    >
      {verdict.kind === 'near' ? (
        <span className={s.formText}>{nearWhat(verdict)}</span>
      ) : (
        <>
          <label className={s.formLabel} htmlFor="preset-name">
            Preset name
          </label>
          <Field id="preset-name" value={name} onChange={(event) => setName(event.target.value)} />
          <span className={s.formText}>
            New tasks can start from these parts: where it works, who checks it, how it ends, who leads it.
          </span>
        </>
      )}
      <span className={s.formFoot}>
        <LinkButton onClick={() => setState('dismissed')}>Don’t offer again</LinkButton>
        <span className={s.grow} />
        <Button size="small" type="submit" disabled={verdict.kind === 'offer' && name.trim() === ''}>
          {keepLabel(verdict)}
        </Button>
      </span>
    </form>
  )
}

/* B · In the foot: a link beside the estimate, inside the card's own foot; it opens the small form. */
function FootLink({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} className={s.inFoot} />
  return (
    <span className={cx(s.quiet, s.inFoot)}>
      ·
      <Popover
        label="Keep as a preset"
        placement="above"
        align="start"
        width={300}
        padded={false}
        open={state === 'editing'}
        onOpenChange={(open) => setState(open ? 'editing' : 'offer')}
        trigger={<LinkButton>{verdict.kind === 'near' ? `Nearly ${verdict.preset.name}` : 'Keep as a preset'}</LinkButton>}
      >
        <KeepForm verdict={verdict} setState={setState} name={name} setName={setName} />
      </Popover>
      <About />
    </span>
  )
}

/* C · Caption: one muted line under the card, outside it, as a caption is. */
function Caption({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  return (
    <div className={s.caption}>
      {state === 'kept' ? (
        <Kept verdict={verdict} name={name} setState={setState} />
      ) : (
        <span className={s.quiet}>
          {verdict.kind === 'near' ? (
            nearWhat(verdict)
          ) : (
            <>
              Keep these parts as
              <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={editingOf(setState)} />
            </>
          )}
          <About />
          <LinkButton className={s.strong} onClick={() => setState('kept')}>
            {keepLabel(verdict)}
          </LinkButton>
          <LinkButton onClick={() => setState('dismissed')}>Not now</LinkButton>
        </span>
      )}
    </div>
  )
}

/* D · Icon: a single mark in the foot, left of Start; pointing at it says what it is, pressing it opens the small form. */
function IconOnly({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept') return <Kept verdict={verdict} name={name} setState={setState} className={s.inFoot} />
  return (
    <span className={s.inFoot}>
      <Popover
        label="Keep as a preset"
        placement="above"
        align="start"
        width={300}
        padded={false}
        open={state === 'editing'}
        onOpenChange={(open) => setState(open ? 'editing' : 'offer')}
        trigger={
          <button type="button" className={s.mark} aria-label="Keep these parts as a preset" title="Keep these parts as a preset">
            <Icon name="pin" size={12} />
            <i className={s.dot} aria-hidden="true" />
          </button>
        }
      >
        <KeepForm verdict={verdict} setState={setState} name={name} setName={setName} />
      </Popover>
    </span>
  )
}

type Place = 'aside' | 'foot' | 'under'
const onCard = (Offer: (props: OfferProps) => ReactNode, place: Place) =>
  function Thread({ title, planParts, ...props }: OfferProps & { title: string; planParts: PresetParts }) {
    const preset = props.state === 'kept' ? (props.verdict.kind === 'near' ? props.verdict.preset.name : props.name) : props.planPreset
    const offer = <Offer {...props} />
    if (place === 'under')
      return (
        <div>
          <PlanCard title={title} parts={planParts} preset={preset} />
          {offer}
        </div>
      )
    return <PlanCard title={title} parts={planParts} preset={preset} {...(place === 'aside' ? { aside: offer } : { footNote: offer })} />
  }

export const DIRECTIONS: ReadonlyArray<Direction> = [
  {
    key: 'q1',
    letter: 'A',
    name: 'Footnote',
    idea: 'The bottom bar, demoted: small muted words under the foot, Keep and Not now as links.',
    Thread: onCard(Footnote, 'aside'),
  },
  {
    key: 'q2',
    letter: 'B',
    name: 'In the foot',
    idea: 'No row of its own: a link beside the estimate, in the card’s own foot. It opens the name and Keep.',
    Thread: onCard(FootLink, 'foot'),
  },
  {
    key: 'q3',
    letter: 'C',
    name: 'Caption',
    idea: 'One muted line under the card, outside it, like a caption.',
    Thread: onCard(Caption, 'under'),
  },
  {
    key: 'q4',
    letter: 'D',
    name: 'Icon',
    idea: 'A single mark beside the estimate, with a dot; pressing it opens the name and Keep.',
    Thread: onCard(IconOnly, 'foot'),
  },
]
