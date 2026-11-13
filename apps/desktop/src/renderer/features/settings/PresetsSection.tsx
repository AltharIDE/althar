import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import type { Preset } from '@althar/contracts'
import { Button, Field, FieldArea, FormRow, Icon, Segmented, SettingList, SettingRow, Switch } from '@althar/ui'

import { useGoneAtOnce } from '../../data/goneAtOnce'
import { useServices } from '../../data/services'

/*
 * The person's presets (a task is a conversation plus parts, "Presets"):
 * named sets of a task's starting parts, the built-in ones and their own,
 * each with what it holds. Their own, saved from a task or kept from the
 * coordinator's offer, can be edited here, its name, parts and brief, kept
 * to the project of the task it came from or not, and removed; nobody has
 * to use this page.
 */

type Parts = Preset['parts']

export const presetsText = {
  title: 'Presets',
  builtIn: 'Built in',
  edit: 'Edit',
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
  ends: { draft: 'Draft pull request', ready: 'Ready for review', none: 'Here' },
  shelves: { board: 'The board', scratch: 'Scratch' },
} as const

const PRESETS = ['presets'] as const

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
        <Segmented value={parts.end} onChange={(end) => set({ end })} options={options(presetsText.ends)} />
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
      {failed !== null && <p role="alert">{failed}</p>}
      <Button size="small" onClick={() => void save()}>
        {presetsText.save}
      </Button>{' '}
      <Button size="small" variant="quiet" onClick={onDone}>
        {presetsText.cancel}
      </Button>
    </div>
  )
}

export function PresetsSection() {
  const { client } = useServices()
  const cache = useQueryClient()
  const read = useQuery({ queryKey: PRESETS, queryFn: () => client.listPresets() }).data
  const gone = useGoneAtOnce(read, (preset) => preset.id)
  const presets = gone.shown
  const [editing, setEditing] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  if (presets === undefined) return null
  const own = presets.filter((one) => !one.builtin)
  return (
    <SettingList>
      {failed !== null && <p role="alert">{failed}</p>}
      {presets.map((preset) => (
        <SettingRow
          key={preset.id}
          title={preset.name}
          note={preset.keptTo === undefined ? preset.about : `${presetsText.keptTo(preset.keptTo)}. ${preset.about}`}
          glyph={<Icon name="list" size={15} />}
          {...(editing === preset.id ? { under: <PresetEditor preset={preset} onDone={() => setEditing(null)} /> } : {})}
        >
          {() =>
            preset.builtin ? (
              <span>{presetsText.builtIn}</span>
            ) : (
              <>
                <Button size="small" variant="quiet" onClick={() => setEditing(editing === preset.id ? null : preset.id)}>
                  {presetsText.edit}
                </Button>
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
              </>
            )
          }
        </SettingRow>
      ))}
      {own.length === 0 && <SettingRow title={presetsText.none}>{() => null}</SettingRow>}
    </SettingList>
  )
}
