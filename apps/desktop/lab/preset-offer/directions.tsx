import { useState, type ReactNode } from 'react'

import {
  AskAnswered,
  AskCard,
  AskFoot,
  AskNote,
  Button,
  Field,
  Icon,
  KeyValues,
  LinkButton,
  Model,
  type ModelInfo,
  TaskEnd,
  TaskLaunch,
  ThreadDivider,
  WorksIn,
} from '@althar/ui'

import { MODEL_LIST } from '../../../../packages/ui/src/fixtures/models'
import type { PresetParts } from './runtime'
import { TIMES, type Verdict, words } from './rules'
import s from './page.module.css'

/*
 * The offer, four ways, each in the coordinator's thread under the plan
 * card it came with, in each of its states. A verdict of `near` is the same
 * place saying which built-in preset fits instead.
 */

export type OfferState = 'offer' | 'editing' | 'kept' | 'dismissed'
export type Shown = Extract<Verdict, { kind: 'offer' | 'near' }>

const base = (id: string) => MODEL_LIST.find((one) => one.id === id) ?? MODEL_LIST[0]!
const MODELS: Readonly<Record<string, ModelInfo>> = {
  'claude-code/claude-opus-5-5': { ...base('claude-opus-5'), id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5' },
  'claude-code/claude-sonnet-5-5': { ...base('claude-sonnet-5'), id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5' },
  'codex/gpt-6.1-sol': { ...base('gpt-5.2-codex'), id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', short: 'Sol' },
}
export const modelOf = (lead: string | null) => (lead === null ? null : (MODELS[lead] ?? null))

/** The parts as Settings › Presets and the plan card name them, keys on the left. */
export function Parts({ parts }: { parts: PresetParts }) {
  const lead = modelOf(parts.lead)
  return (
    <KeyValues
      keyWidth={78}
      items={[
        ['Works in', words.workspace[parts.workspace]],
        ['Checked by', words.checked[parts.checked]],
        ['Ends', words.end[parts.end]],
        ['Led by', lead === null ? 'The coordinator’s pick' : <Model key="lead" model={lead} short />],
      ]}
    />
  )
}

/** The same parts on one line, as the preset picker's descriptions read. */
const SHORT = {
  workspace: { copy: 'A copy', worktree: 'Worktree', local: 'Local' },
  checked: { before: 'reviewed before shipping', after: 'reviewed after merge', none: 'no review' },
  end: { draft: 'draft PR', ready: 'ready PR', none: 'on its branch' },
} as const
const partsLine = (parts: PresetParts) =>
  [SHORT.workspace[parts.workspace], SHORT.checked[parts.checked], SHORT.end[parts.end], modelOf(parts.lead)?.short]
    .filter(Boolean)
    .join(' · ')

/** The plan card the offer came with, from the kit: its preset in the kicker, its steps, how it ends. */
export function PlanCard({
  title,
  parts,
  preset,
  presets,
  onPresetChange,
}: {
  title: string
  parts: PresetParts
  preset: string
  presets?: readonly { name: string; about: string }[]
  onPresetChange?: (name: string) => void
}) {
  const lead = modelOf(parts.lead) ?? MODELS['claude-code/claude-opus-5-5']!
  const reviewer = modelOf(parts.reviewer) ?? MODELS['codex/gpt-6.1-sol']!
  return (
    <TaskLaunch
      task="812"
      preset={preset}
      {...(presets === undefined ? {} : { presets })}
      {...(onPresetChange === undefined ? {} : { onPresetChange })}
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
    />
  )
}

export interface OfferProps {
  verdict: Shown
  state: OfferState
  setState: (state: OfferState) => void
  name: string
  setName: (name: string) => void
}

export interface Direction {
  key: string
  letter: string
  name: string
  idea: string
  /** What the direction draws under the coordinator's message: the plan card, and the offer where it goes. */
  Thread: (props: OfferProps & { title: string; planParts: PresetParts; planPreset: string }) => ReactNode
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
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') setEditing(false)
        }}
      />
    )
  return (
    <button type="button" className={s.name} onClick={() => setEditing(true)} title="Rename">
      {name}
      <Icon name="pencil" size={10} />
    </button>
  )
}

const nearWhat = (v: Extract<Verdict, { kind: 'near' }>) => `These are ${v.preset.name}, ${v.differs}.`

/* A · A card in the thread, as a setting change asks: its name in a field, its parts, Keep and Not now. */
function CardOffer({ verdict, state, setState, name, setName }: OfferProps) {
  if (verdict.kind === 'near') {
    if (state === 'kept')
      return (
        <AskAnswered said={`${verdict.preset.name} for tasks like these`} onUndo={() => setState('offer')}>
          <AskNote>{verdict.differs.charAt(0).toUpperCase() + verdict.differs.slice(1)}</AskNote>
        </AskAnswered>
      )
    if (state === 'dismissed')
      return (
        <AskAnswered denied said="Not now" onUndo={() => setState('offer')}>
          <AskNote>Not said again for these parts</AskNote>
        </AskAnswered>
      )
    return (
      <AskCard icon="list" kicker="Preset" quiet what={nearWhat(verdict)}>
        <AskFoot>
          <Button variant="quiet" onClick={() => setState('dismissed')}>
            Not now
          </Button>
          <Button variant="signal" onClick={() => setState('kept')}>
            Plan them as {verdict.preset.name}
          </Button>
        </AskFoot>
      </AskCard>
    )
  }
  if (state === 'kept')
    return (
      <AskAnswered said={`Kept “${name}”`} onUndo={() => setState('offer')}>
        <AskNote>Settings › Presets</AskNote>
      </AskAnswered>
    )
  if (state === 'dismissed')
    return (
      <AskAnswered denied said="Not now" onUndo={() => setState('offer')}>
        <AskNote>Not offered again for these parts</AskNote>
      </AskAnswered>
    )
  return (
    <AskCard icon="list" kicker="Preset" quiet what={`You set these parts up ${TIMES} times. Keep them as a preset?`}>
      <div className={s.cardBody}>
        <label className={s.cardName}>
          <span>Name</span>
          <Field
            value={name}
            autoFocus={state === 'editing'}
            onFocus={() => setState('editing')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Parts parts={verdict.parts} />
      </div>
      <AskFoot>
        <Button variant="quiet" onClick={() => setState('dismissed')}>
          Not now
        </Button>
        <Button variant="signal" disabled={name.trim() === ''} onClick={() => setState('kept')}>
          Keep
        </Button>
      </AskFoot>
    </AskCard>
  )
}

/* B · One line of Althar's across the thread: the name in place, the parts after it, Keep and a cross. */
function LineOffer({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'kept')
    return (
      <ThreadDivider icon="list" action="Undo" onAction={() => setState('offer')}>
        {verdict.kind === 'near' ? `${verdict.preset.name} for tasks like these` : `Kept as a preset: ${name}`}
      </ThreadDivider>
    )
  if (state === 'dismissed') return null
  return (
    <div className={s.line}>
      <Icon name="list" size={11} />
      {verdict.kind === 'near' ? (
        <span className={s.lineText}>{nearWhat(verdict)}</span>
      ) : (
        <>
          <span className={s.lineText}>Keep as a preset</span>
          <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={(e) => setState(e ? 'editing' : 'offer')} />
          <span className={s.linePart}>{partsLine(verdict.parts)}</span>
        </>
      )}
      <span className={s.rule} aria-hidden="true" />
      <Button size="small" variant="default" onClick={() => setState('kept')}>
        {verdict.kind === 'near' ? `Use ${verdict.preset.name}` : 'Keep'}
      </Button>
      <button type="button" className={s.cross} aria-label="Not now" onClick={() => setState('dismissed')}>
        <Icon name="close" size={10} />
      </button>
    </div>
  )
}

/* C · On the plan card itself: a foot under its steps, since the card already shows the parts. */
function FootOffer({ verdict, state, setState, name, setName }: OfferProps) {
  if (state === 'dismissed') return null
  if (state === 'kept')
    return (
      <div className={s.foot}>
        <Icon name="check" size={11} />
        <span className={s.footText}>
          {verdict.kind === 'near' ? `Tasks like these start from ${verdict.preset.name}` : `Kept as a preset`}
        </span>
        <LinkButton onClick={() => setState('offer')}>Undo</LinkButton>
      </div>
    )
  return (
    <div className={s.foot}>
      {verdict.kind === 'near' ? (
        <span className={s.footText}>{nearWhat(verdict)}</span>
      ) : (
        <>
          <span className={s.footText}>Your third plan like this. Keep it as</span>
          <NameInPlace name={name} setName={setName} editing={state === 'editing'} setEditing={(e) => setState(e ? 'editing' : 'offer')} />
        </>
      )}
      <span className={s.grow} />
      <LinkButton onClick={() => setState('dismissed')}>Not now</LinkButton>
      <Button size="small" variant="ink" onClick={() => setState('kept')}>
        {verdict.kind === 'near' ? `Use ${verdict.preset.name}` : 'Keep'}
      </Button>
    </div>
  )
}

const BUILT_INS = [
  { name: 'Change', about: 'A worktree · checked before it ships · draft pull request' },
  { name: 'Small change', about: 'A worktree · checked after it merges · ready for review' },
  { name: 'Prototype', about: 'A worktree · checked after it merges · on its branch · Opus 5.5' },
  { name: 'Chat', about: 'A copy · nobody checks · on Scratch' },
]

/* D · Nothing in the thread: the plan card's preset picker suggests it first; picking it keeps it. */
function PickerThread({
  verdict,
  state,
  setState,
  name,
  setName,
  title,
  planParts,
  planPreset,
}: OfferProps & { title: string; planParts: PresetParts; planPreset: string }) {
  const [editing, setEditing] = useState(false)
  const suggested =
    verdict.kind === 'near'
      ? []
      : state === 'offer' || state === 'editing'
        ? [{ name, about: `Suggested: yours ${TIMES} times. ${partsLine(verdict.parts)}` }]
        : state === 'kept'
          ? [{ name, about: partsLine(verdict.parts) }]
          : []
  const builtIns =
    verdict.kind === 'near'
      ? [{ name: verdict.preset.name, about: `Fits, ${verdict.differs}` }, ...BUILT_INS.filter((one) => one.name !== verdict.preset.name)]
      : BUILT_INS
  const presets = [...suggested, ...builtIns]
  const preset = state === 'kept' ? (verdict.kind === 'near' ? verdict.preset.name : name) : planPreset
  return (
    <>
      <PlanCard
        title={title}
        parts={planParts}
        preset={preset}
        presets={presets}
        onPresetChange={(picked) => {
          if (picked === name || (verdict.kind === 'near' && picked === verdict.preset.name)) setState('kept')
          else if (state === 'offer' || state === 'editing') setState('dismissed')
        }}
      />
      {state === 'kept' && verdict.kind === 'offer' && (
        <div className={s.foot}>
          <Icon name="check" size={11} />
          <span className={s.footText}>Kept as</span>
          <NameInPlace name={name} setName={setName} editing={editing} setEditing={setEditing} />
          <span className={s.grow} />
          <LinkButton onClick={() => setState('offer')}>Undo</LinkButton>
        </div>
      )}
    </>
  )
}

const withCard = (Offer: (props: OfferProps) => ReactNode, under = false) =>
  function Thread(props: OfferProps & { title: string; planParts: PresetParts; planPreset: string }) {
    const kept = props.state === 'kept'
    const preset = under && kept ? (props.verdict.kind === 'near' ? props.verdict.preset.name : props.name) : props.planPreset
    return (
      <>
        <div className={under ? s.joined : undefined}>
          <PlanCard title={props.title} parts={props.planParts} preset={preset} />
          {under && <Offer {...props} />}
        </div>
        {!under && <Offer {...props} />}
      </>
    )
  }

export const DIRECTIONS: ReadonlyArray<Direction> = [
  {
    key: 'a',
    letter: 'A',
    name: 'Card',
    idea: 'A card in the thread, as a setting change asks: the name in a field, the parts as Settings lists them, Keep and Not now.',
    Thread: withCard(CardOffer),
  },
  {
    key: 'b',
    letter: 'B',
    name: 'Line',
    idea: 'One line across the thread: the name, editable in place, the parts after it, Keep and a cross. Kept, it is a line with Undo.',
    Thread: withCard(LineOffer),
  },
  {
    key: 'c',
    letter: 'C',
    name: 'On the plan card',
    idea: 'A foot on the plan card it came with, which already shows the parts. Kept, the card’s kicker takes the new name.',
    Thread: withCard(FootOffer, true),
  },
  {
    key: 'd',
    letter: 'D',
    name: 'In the picker',
    idea: 'Nothing in the thread. The plan card’s preset menu (its kicker) lists it first; picking it keeps it. Picking another drops it.',
    Thread: PickerThread,
  },
]
