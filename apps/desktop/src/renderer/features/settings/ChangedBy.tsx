import { useQuery } from '@tanstack/react-query'

import type { SettingChanged } from '@althar/contracts'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'
import s from './ChangedBy.module.css'

/*
 * Who changed a section's settings last, where an agent did (ADR-097): the
 * coordinator, or a task's lead, and when, while each setting stays as it
 * left it. Changed since, by the person or anyone, a setting is theirs
 * again and isn't named here.
 */

export const text = {
  who: (by: SettingChanged['by']) =>
    by.kind === 'coordinator' ? 'The coordinator' : by.title === null ? 'A task’s lead' : `The lead of “${by.title}”`,
  line: (who: string, labels: ReadonlyArray<string>, when: string) => `${who} changed ${list(labels)} ${when}.`,
}

const list = (labels: ReadonlyArray<string>) =>
  labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`

/** A section's agents' changes, by its address: `althar/plans-and-reviews`, or `project/rules` with its project. */
export function ChangedBy({ projectId, section }: { projectId: string | null; section: string }) {
  const { client } = useServices()
  const changed = useQuery(reads(client).settingChanges(projectId)).data ?? []
  const here = changed.filter((one) => one.section === section)
  if (here.length === 0) return null
  // One line for each agent, its settings in the order Settings changed them, the latest time.
  const byWho = new Map<string, { who: string; labels: Array<string>; at: string }>()
  for (const one of here) {
    const key = `${one.by.kind}:${one.by.taskId ?? ''}`
    const kept = byWho.get(key) ?? { who: text.who(one.by), labels: [], at: one.at }
    kept.labels.push(one.label)
    if (one.at > kept.at) kept.at = one.at
    byWho.set(key, kept)
  }
  return (
    <ul className={s.changed}>
      {[...byWho.entries()].map(([key, one]) => (
        <li key={key}>{text.line(one.who, one.labels, ago(one.at))}</li>
      ))}
    </ul>
  )
}
