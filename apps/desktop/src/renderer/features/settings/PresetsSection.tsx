import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import type { AgentStatus, Preset } from '@althar/contracts'
import { Button, Field, FieldArea, FormRow, Icon, Segmented, SettingList, SettingRow, Switch, Problem } from '@althar/ui'

import { useGoneAtOnce } from '../../data/goneAtOnce'
import { canCall } from '../../data/client'
import { useServices } from '../../data/services'
import { ModelChoice, type ModelChoiceProps } from '../../shared/ModelChoice'

/*
 * The person's presets (a task is a conversation plus parts, "Presets"):
 * named sets of a task's starting parts, the built-in ones and their own,
 * each with what it holds. Their own, saved from a task or kept from the
 * coordinator's offer, can be edited here, its name, parts and brief, kept
 * to the project of the task it came from or not, and removed. A built-in
 * one names no model; the person can tune its lead, reviewer, their efforts
 * and its brief as their own, and reset it to the built-in. Nobody has to
 * use this page.
 */

type Parts = Preset['parts']
type Choice = ModelChoiceProps['value']

export const presetsText = {
  title: 'Presets',
  builtIn: 'Built in',
  tuned: 'Tuned',
  edit: 'Edit',
  tune: 'Tune',
  reset: 'Reset',
  lead: 'Lead',
  reviewer: 'Reviewer',
  picked: 'Picked for each task',
  pickedNote: 'By your defaults and the coordinator’s choice, as for any task.',
  setOne: 'Choose a model',
  unset: 'Back to picked for each task',
  remove: 'Remove',
  save: 'Save',
  cancel: 'Cancel',
  none: 'Save one from any task’s menu, or keep the one the coordinator offers.',
  keptTo: (project: string) => `Only in ${project}`,
  name: 'Name',
  workspace: 'Works in',
  checked: 'Checked by',
  end: 'Ends',
  shelf: 'Sits',
  brief: 'Brief',
  briefNote: 'A few lines its lead reads first.',
  team: (lead: string | null, reviewer: string | null) =>
    `Led by ${lead ?? 'the lead the coordinator picks'}${reviewer === null ? '' : `, reviewed by ${reviewer}`}. Change them on a task, then save it again.`,
  onlyIn: (project: string) => `Only in ${project}`,
  onlyInNote: 'Kept to the project of the task it was saved from; off, it works in every project.',
  workspaces: { copy: 'A copy', worktree: 'A worktree', local: 'Local' },
  checks: { before: 'Before it ships', after: 'After it merges', none: 'Nobody' },
  ends: { project: 'As the project says', draft: 'Draft pull request', ready: 'Ready for review', none: 'Here' },
  shelves: { board: 'The board', scratch: 'Scratch' },
} as const

const PRESETS = ['presets'] as const

/** A preset's `agent/model` as the model picker takes it, and back; `default` is the agent's own model. */
const choiceOf = (named: string | null, effort: string | null | undefined): Choice | null => {
  if (named === null) return null
  const at = named.indexOf('/')
  const model = at < 0 ? null : named.slice(at + 1)
  return {
    agentId: at < 0 ? named : named.slice(0, at),
    model: model === null || model === 'default' ? null : model,
    effort: effort ?? null,
  }
}
const namedOf = (choice: Choice) => `${choice.agentId}/${choice.model ?? 'default'}`

/** A built-in preset's lead or reviewer, as the person tunes it: picked for each task, or a model of theirs. */
function TunedPick({
  owner,
  agents,
  value,
  onChange,
}: {
  owner: string
  agents: ReadonlyArray<AgentStatus>
  value: Choice | null
  onChange: (choice: Choice | null) => void
}) {
  const first = agents[0]
  if (value === null)
    return (
      <span>
        {presetsText.picked}{' '}
        {first !== undefined && (
          <Button size="small" variant="quiet" onClick={() => onChange({ agentId: first.id, model: null, effort: null })}>
            {presetsText.setOne}
          </Button>
        )}
      </span>
    )
  return (
    <ModelChoice
      owner={owner}
      agents={agents}
      value={value}
      onChange={onChange}
      onRemove={() => onChange(null)}
      variant="field"
      placement="below"
      text={{ remove: presetsText.unset }}
    />
  )
}

/** A built-in preset, as its row opens to tune it: its lead, reviewer, their efforts and its brief, as the person's own. */
function PresetTuner({ preset, agents, onDone }: { preset: Preset; agents: ReadonlyArray<AgentStatus>; onDone: () => void }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const [lead, setLead] = useState(choiceOf(preset.parts.lead, preset.parts.effort))
  const [reviewer, setReviewer] = useState(choiceOf(preset.parts.reviewer, preset.parts.reviewerEffort))
  const [brief, setBrief] = useState(preset.parts.brief)
  const [failed, setFailed] = useState<string | null>(null)
  const ids = useId()
  const save = async () => {
    try {
      await client.tunePreset(preset.id, {
        lead: lead === null ? null : namedOf(lead),
        effort: lead?.effort ?? null,
        reviewer: reviewer === null ? null : namedOf(reviewer),
        reviewerEffort: reviewer?.effort ?? null,
        brief,
      })
      await cache.invalidateQueries({ queryKey: PRESETS })
      onDone()
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div>
      <FormRow label={presetsText.lead} note={lead === null ? presetsText.pickedNote : undefined}>
        <TunedPick owner={presetsText.lead} agents={agents} value={lead} onChange={setLead} />
      </FormRow>
      {preset.parts.checked !== 'none' && (
        <FormRow label={presetsText.reviewer} note={reviewer === null ? presetsText.pickedNote : undefined}>
          <TunedPick owner={presetsText.reviewer} agents={agents} value={reviewer} onChange={setReviewer} />
        </FormRow>
      )}
      <FormRow label={presetsText.brief} note={presetsText.briefNote} htmlFor={`${ids}-brief`}>
        <FieldArea id={`${ids}-brief`} rows={3} value={brief} onChange={(event) => setBrief(event.target.value)} />
      </FormRow>
      {failed !== null && <Problem>{failed}</Problem>}
      {/* oxlint-disable-next-line althar/press-at-once -- A form the runtime checks: it stays open until kept, so a refusal lands in it. */}
      <Button size="small" onClick={() => void save()}>
        {presetsText.save}
      </Button>{' '}
      <Button size="small" variant="quiet" onClick={onDone}>
        {presetsText.cancel}
      </Button>
    </div>
  )
}

const options = <K extends string>(words: Readonly<Record<K, string>>) =>
  (Object.keys(words) as Array<K>).map((value) => ({ value, label: words[value] }))

/** One of the person's presets, as its row opens to edit it. */
function PresetEditor({ preset, onDone }: { preset: Preset; onDone: () => void }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const [name, setName] = useState(preset.name)
  const [parts, setParts] = useState<Parts>(preset.parts)
  const [only, setOnly] = useState(preset.keptTo !== undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const ids = useId()
  const set = (patch: Partial<Parts>) => setParts({ ...parts, ...patch })
  const save = async () => {
    try {
      await client.editPreset({ id: preset.id, name, parts, ...(preset.from === undefined ? {} : { projectOnly: only }) })
      await cache.invalidateQueries({ queryKey: PRESETS })
      onDone()
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div>
      <FormRow label={presetsText.name} htmlFor={`${ids}-name`}>
        <Field id={`${ids}-name`} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </FormRow>
      <FormRow label={presetsText.workspace}>
        <Segmented value={parts.workspace} onChange={(workspace) => set({ workspace })} options={options(presetsText.workspaces)} />
      </FormRow>
      <FormRow label={presetsText.checked}>
        <Segmented value={parts.checked} onChange={(checked) => set({ checked })} options={options(presetsText.checks)} />
      </FormRow>
      <FormRow label={presetsText.end}>
        <Segmented
          value={parts.end ?? 'project'}
          onChange={(end) => {
            if (end !== 'project') return set({ end })
            const { end: _own, ...rest } = parts
            setParts(rest)
          }}
          options={options(presetsText.ends)}
        />
      </FormRow>
      <FormRow label={presetsText.shelf}>
        <Segmented value={parts.shelf} onChange={(shelf) => set({ shelf })} options={options(presetsText.shelves)} />
      </FormRow>
      <FormRow label={presetsText.brief} note={presetsText.briefNote} htmlFor={`${ids}-brief`}>
        <FieldArea id={`${ids}-brief`} rows={3} value={parts.brief} onChange={(event) => set({ brief: event.target.value })} />
      </FormRow>
      <p>{presetsText.team(parts.lead, parts.reviewer)}</p>
      {preset.from !== undefined && (
        <FormRow label={presetsText.onlyIn(preset.from)} note={presetsText.onlyInNote}>
          <Switch checked={only} onChange={setOnly} label={presetsText.onlyIn(preset.from)} />
        </FormRow>
      )}
      {failed !== null && <Problem>{failed}</Problem>}
      {/* oxlint-disable-next-line althar/press-at-once -- A form the runtime checks (a name another preset has): it stays open until kept, so a refusal lands in it. */}
      <Button size="small" onClick={() => void save()}>
        {presetsText.save}
      </Button>{' '}
      <Button size="small" variant="quiet" onClick={onDone}>
        {presetsText.cancel}
      </Button>
    </div>
  )
}

/**
 * Built-in presets the person reset, shown as built in, naming no model (`asBuilt`), from the frame they pressed Reset
 * (docs/decisions/foundations.md, "The UI is instant"). Each stays so until a read with it untuned lands, so no read from
 * before the reset, however reads overlap, brings its tuning back for a moment; `back` returns one the runtime kept.
 */
function useResetAtOnce(items: ReadonlyArray<Preset> | undefined) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set())
  // A read with it untuned says it is reset: from then on it is the read's to show.
  if (items !== undefined && held.size > 0) {
    const still = [...held].filter((id) => items.some((one) => one.id === id && one.tuned === true))
    if (still.length !== held.size) setHeld(new Set(still))
  }
  const asBuilt = (one: Preset): Preset => {
    if (!held.has(one.id) || one.asBuilt === undefined) return one
    const { tuned: _tuned, asBuilt: built, ...rest } = one
    return { ...rest, parts: built.parts, about: built.about }
  }
  return {
    shown: items === undefined || held.size === 0 ? items : items.map(asBuilt),
    hold: (id: string) => setHeld((was) => new Set([...was, id])),
    back: (id: string) =>
      setHeld((was) => {
        const next = new Set(was)
        next.delete(id)
        return next
      }),
  }
}

export function PresetsSection({ agents = [] }: { agents?: ReadonlyArray<AgentStatus> }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const read = useQuery({ queryKey: PRESETS, queryFn: () => client.listPresets() }).data
  const gone = useGoneAtOnce(read, (preset) => preset.id)
  const reset = useResetAtOnce(gone.shown)
  const presets = reset.shown
  const [editing, setEditing] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // What the window's home takes from it: a home on another computer resets a tuned preset, and leaves removing one of
  // the person's own to them.
  const resets = canCall(client, 'ResetPreset')
  const removes = canCall(client, 'RemovePreset')
  if (presets === undefined) return null
  const own = presets.filter((one) => !one.builtin)
  return (
    <SettingList>
      {failed !== null && <Problem>{failed}</Problem>}
      {presets.map((preset) => (
        <SettingRow
          key={preset.id}
          title={preset.name}
          note={preset.keptTo === undefined ? preset.about : `${presetsText.keptTo(preset.keptTo)}. ${preset.about}`}
          glyph={<Icon name="list" size={15} />}
          {...(editing === preset.id
            ? {
                under: preset.builtin ? (
                  <PresetTuner
                    preset={preset}
                    agents={agents}
                    onDone={() => {
                      // Tuned again: the read is theirs to show, not a reset held from before.
                      reset.back(preset.id)
                      setEditing(null)
                    }}
                  />
                ) : (
                  <PresetEditor preset={preset} onDone={() => setEditing(null)} />
                ),
              }
            : {})}
        >
          {() =>
            preset.builtin ? (
              <>
                <span>{preset.tuned === true ? presetsText.tuned : presetsText.builtIn}</span>
                <Button size="small" variant="quiet" onClick={() => setEditing(editing === preset.id ? null : preset.id)}>
                  {presetsText.tune}
                </Button>
                {preset.tuned === true && resets && (
                  <Button
                    size="small"
                    variant="quiet"
                    onClick={() => {
                      // Back to the built-in at once, until a read with it untuned lands; a refusal brings the tuning back, with a line.
                      setFailed(null)
                      setEditing(null)
                      reset.hold(preset.id)
                      void client
                        .resetPreset(preset.id)
                        .catch((error: unknown) => {
                          reset.back(preset.id)
                          setFailed(error instanceof Error ? error.message : String(error))
                        })
                        .finally(() => void cache.invalidateQueries({ queryKey: PRESETS }))
                    }}
                  >
                    {presetsText.reset}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="small" variant="quiet" onClick={() => setEditing(editing === preset.id ? null : preset.id)}>
                  {presetsText.edit}
                </Button>
                {removes && (
                  <Button
                    size="small"
                    variant="quiet"
                    onClick={() => {
                      // It goes at once and stays gone until a list without it is read; one the runtime kept comes back, with a line.
                      setFailed(null)
                      gone.hide([preset.id])
                      void client
                        .removePreset(preset.id)
                        .catch((error: unknown) => {
                          gone.back(preset.id)
                          setFailed(error instanceof Error ? error.message : String(error))
                        })
                        .finally(() => void cache.invalidateQueries({ queryKey: PRESETS }))
                    }}
                  >
                    {presetsText.remove}
                  </Button>
                )}
              </>
            )
          }
        </SettingRow>
      ))}
      {own.length === 0 && <SettingRow title={presetsText.none}>{() => null}</SettingRow>}
    </SettingList>
  )
}
