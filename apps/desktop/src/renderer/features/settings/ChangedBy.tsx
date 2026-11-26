import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { SettingChanged } from '@althar/contracts'
import { LinkButton } from '@althar/ui'

import { canCall } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'
import s from './ChangedBy.module.css'

/*
 * Who changed a section's settings last, where an agent did (ADR-097): the
 * coordinator, or a task's lead, and when, while each setting stays as it
 * left it, and what each moved in the plain words its line in the thread
 * says. Changed since, by the person or anyone, a setting is theirs again
 * and isn't named here.
 */

export const text = {
  who: (by: SettingChanged['by']) =>
    by.kind === 'coordinator' ? 'The coordinator' : by.title === null ? 'A task’s lead' : `The lead of “${by.title}”`,
  line: (who: string, labels: ReadonlyArray<string>, when: string) => `${who} changed ${list(labels)} ${when}.`,
  show: (count: number) => `Show all ${count}`,
  hide: 'Hide',
}

/** The lines a change reads in full under its sentence, before the rest wait behind Show all. */
const FEW = 3

const list = (labels: ReadonlyArray<string>) =>
  labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`

/** One agent's change: its sentence, then what it moved, a line each. */
function One({ who, labels, at, lines }: { who: string; labels: ReadonlyArray<string>; at: string; lines: ReadonlyArray<string> }) {
  const [all, setAll] = useState(false)
  return (
    <li>
      {text.line(who, labels, ago(at))}
      {lines.length > 0 && (
        <ul className={s.lines}>
          {(all ? lines : lines.slice(0, FEW)).map((line, place) => (
            <li key={`${place}:${line}`}>{line}</li>
          ))}
        </ul>
      )}
      {lines.length > FEW && (
        <LinkButton aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? text.hide : text.show(lines.length)}
        </LinkButton>
      )}
    </li>
  )
}

/** A section's agents' changes, by its address: `althar/plans-and-reviews`, or `project/rules` with its project. */
export function ChangedBy({ projectId, section }: { projectId: string | null; section: string }) {
  const { client } = useServices()
  // Not asked of a home that doesn't share its settings' history with this window: nothing to say there.
  const changed = useQuery({ ...reads(client).settingChanges(projectId), enabled: canCall(client, 'GetSettingChanges') }).data ?? []
  const here = changed.filter((one) => one.section === section)
  if (here.length === 0) return null
  // One line for each agent, its settings in the order Settings changed them, the latest time.
  const byWho = new Map<string, { who: string; labels: Array<string>; lines: Array<string>; at: string }>()
  for (const one of here) {
    const key = `${one.by.kind}:${one.by.taskId ?? ''}`
    const kept = byWho.get(key) ?? { who: text.who(one.by), labels: [], lines: [], at: one.at }
    kept.labels.push(one.label)
    kept.lines.push(...(one.changes ?? []))
    if (one.at > kept.at) kept.at = one.at
    byWho.set(key, kept)
  }
  return (
    <ul className={s.changed}>
      {[...byWho.entries()].map(([key, one]) => (
        <One key={key} who={one.who} labels={one.labels} at={one.at} lines={one.lines} />
      ))}
    </ul>
  )
}
