import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Select } from '../../primitives/Select/Select'
import { SettingRow } from '../Preferences/Preferences'

/*
 * Where a project's issues go: one of the trackers connected, and where on
 * it (a Linear team), or, unset, wherever its issues already are, as Althar
 * learns from them. Bound, its drafts go there, its issues are listed from
 * there alone, and a bare key is looked for there first. Two rows of a
 * setting list: the tracker, and, once one is chosen, where on it.
 */

export interface TrackerChoice {
  /** The connection, by its id. */
  id: string
  /** Linear · FNT, Jira · acme.atlassian.net: the service, and which of it. */
  label: string
  brand?: Brand
}

export interface ContainerChoice {
  id: string
  /** Its name, with its key where it has one: FNT (Fintech). */
  label: string
}

export interface TrackerBindingText {
  title: string
  note: string
  learned: string
  container: string
  containerNote: string
  anyContainer: string
  reading: string
}

export const trackerBindingText: TrackerBindingText = {
  title: 'Issues go to',
  note: 'Drafts go there, and the coordinator lists and finds issues there alone. Unset, it follows where the project’s issues already are.',
  learned: 'Where its issues are',
  container: 'Team',
  containerNote: 'Where its drafts are filed on it.',
  anyContainer: 'As its issues say',
  reading: 'Reading its teams',
}

export interface TrackerBindingProps {
  /** The trackers connected, each one of its workspaces or sites. */
  trackers: readonly TrackerChoice[]
  /** The tracker chosen, by its connection; null for none, where its issues are learned. */
  value: string | null
  /** Where on it; null for as its issues say. */
  container: ContainerChoice | null
  /** Where on the chosen one issues can be filed; null while they are read. */
  containers: readonly ContainerChoice[] | null
  onChange: (tracker: string | null) => void
  onContainer: (container: ContainerChoice | null) => void
  disabled?: boolean
  text?: Partial<TrackerBindingText>
}

const LEARNED = '\u0000learned'
const ANY = '\u0000any'

/** The tracker a project's issues go to, and where on it, as two rows of a setting list. */
export function TrackerBinding({ trackers, value, container, containers, onChange, onContainer, disabled, text }: TrackerBindingProps) {
  const t = { ...trackerBindingText, ...text }
  const chosen = trackers.find((tracker) => tracker.id === value)
  // The one chosen stays a choice while its tracker's teams are read, or once it no longer has it.
  const shown = [
    ...(containers ?? []),
    ...(container !== null && !(containers ?? []).some((one) => one.id === container.id) ? [container] : []),
  ]
  return (
    <>
      <SettingRow
        title={t.title}
        note={t.note}
        {...(chosen?.brand === undefined ? {} : { mark: <BrandMark brand={chosen.brand} size={18} /> })}
      >
        {() => (
          <Select
            label={t.title}
            value={chosen === undefined ? LEARNED : chosen.id}
            options={[{ value: LEARNED, label: t.learned }, ...trackers.map((tracker) => ({ value: tracker.id, label: tracker.label }))]}
            onChange={(picked) => onChange(picked === LEARNED ? null : picked)}
            {...(disabled === undefined ? {} : { disabled })}
          />
        )}
      </SettingRow>
      {chosen !== undefined && (
        <SettingRow title={t.container} note={containers === null ? t.reading : t.containerNote} indent>
          {() => (
            <Select
              label={t.container}
              value={container?.id ?? ANY}
              options={[{ value: ANY, label: t.anyContainer }, ...shown.map((one) => ({ value: one.id, label: one.label }))]}
              onChange={(picked) => onContainer(shown.find((one) => one.id === picked) ?? null)}
              disabled={disabled === true || containers === null}
            />
          )}
        </SettingRow>
      )}
    </>
  )
}
