import type { IssueChange, Priority } from '@althar/connectors'
import { type IssueChangeLine, IssueChangeLine as Line } from '@althar/contracts'
import { Option, Schema } from 'effect'

/*
 * Changes to issues in words (IssueChanges.ts): what an agent hears of a
 * card, and what a thread's transcript says of it. "status to Done",
 * "labels +bug −docs", "a comment".
 */

/** A line of a change in words. */
export const lineWords = (line: IssueChangeLine): string => {
  if ('add' in line) return `${line.field} ${[...line.add.map((one) => `+${one}`), ...line.remove.map((one) => `−${one}`)].join(' ')}`
  switch (line.field) {
    case 'close':
      return 'closed'
    case 'assignee':
      return line.to === null ? 'unassigned' : `assigned to ${line.to}`
    case 'project':
    case 'milestone':
    case 'cycle':
      return line.to === null ? `out of its ${line.field}` : `${line.field} to ${line.to}`
    case 'parent':
      return line.to === null ? 'out of its parent' : `part of ${line.to}`
    case 'estimate':
      return line.to === null ? 'no estimate' : `estimate to ${line.to}`
    case 'due':
      return line.to === null ? 'no due date' : `due ${line.to}`
    case 'description':
      return 'its description rewritten'
    case 'comment':
      return 'a comment'
    case 'link':
      return `a link to ${line.to ?? ''}`
    default:
      return `${line.field} to ${line.to ?? ''}`
  }
}

const decodeLines = Schema.decodeUnknownOption(Schema.Array(Line))

/** A card's lines for an issue, as its item keeps them, in words; nothing for what doesn't read as lines. */
export const changeLinesWords = (lines: unknown): string =>
  Option.match(decodeLines(lines), { onNone: () => '', onSome: (read) => read.map(lineWords).join(', ') })

/** A priority as trackers show it. */
const PRIORITY_WORDS: Readonly<Record<Priority, string>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
}

/** What an issue's entry on a card holds that its lines say: its change, and its comment or link. */
export interface Said {
  readonly key: string
  readonly change: IssueChange
  readonly comment?: string
  readonly link?: { readonly url: string; readonly title: string }
  /** Whether its tracker gives an issue one assignee or several: how people put on it read. Several where not kept. */
  readonly assignees?: 'one' | 'many'
}

/**
 * Who a change assigns, in a line: on a tracker with one assignee, the one
 * it is assigned to, or unassigned; on one with several, those put on and
 * taken off; everyone taken off, unassigned.
 */
const assigneeLines = (change: IssueChange['assignee'], kind: 'one' | 'many'): ReadonlyArray<IssueChangeLine> => {
  if (change === undefined) return []
  if (change === null) return [{ field: 'assignee', to: null }]
  if (kind === 'one') {
    const added = change.add.at(-1)
    return [{ field: 'assignee', to: added?.name ?? null }]
  }
  return [{ field: 'assignees', add: change.add.map((one) => one.name), remove: change.remove.map((one) => one.name) }]
}

/** What one issue's change says, in a line: the card's, and what agents hear. */
export const linesOf = (entry: Omit<Said, 'key'>): ReadonlyArray<IssueChangeLine> => {
  const { change: wanted } = entry
  return [
    ...(wanted.status === undefined ? [] : [{ field: 'status' as const, to: wanted.status.name }]),
    ...(wanted.close === true ? [{ field: 'close' as const, to: null }] : []),
    ...(wanted.priority === undefined ? [] : [{ field: 'priority' as const, to: PRIORITY_WORDS[wanted.priority] }]),
    ...assigneeLines(wanted.assignee, entry.assignees ?? 'many'),
    ...(wanted.labels === undefined
      ? []
      : [
          {
            field: 'labels' as const,
            add: wanted.labels.add.map((label) => label.name),
            remove: wanted.labels.remove.map((label) => label.name),
          },
        ]),
    ...(wanted.project === undefined ? [] : [{ field: 'project' as const, to: wanted.project?.name ?? null }]),
    ...(wanted.milestone === undefined ? [] : [{ field: 'milestone' as const, to: wanted.milestone?.name ?? null }]),
    ...(wanted.cycle === undefined ? [] : [{ field: 'cycle' as const, to: wanted.cycle?.name ?? null }]),
    ...(wanted.parent === undefined ? [] : [{ field: 'parent' as const, to: wanted.parent?.key ?? null }]),
    ...(wanted.estimate === undefined
      ? []
      : [{ field: 'estimate' as const, to: wanted.estimate === null ? null : String(wanted.estimate) }]),
    ...(wanted.type === undefined ? [] : [{ field: 'type' as const, to: wanted.type.name }]),
    ...(wanted.components === undefined
      ? []
      : [{ field: 'components' as const, to: wanted.components.map((component) => component.name).join(', ') }]),
    ...(wanted.due === undefined ? [] : [{ field: 'due' as const, to: wanted.due }]),
    ...(wanted.title === undefined ? [] : [{ field: 'title' as const, to: wanted.title }]),
    ...(wanted.description === undefined ? [] : [{ field: 'description' as const, to: wanted.description }]),
    ...(entry.comment === undefined ? [] : [{ field: 'comment' as const, to: entry.comment }]),
    ...(entry.link === undefined ? [] : [{ field: 'link' as const, to: entry.link.url }]),
  ]
}

/** What a card changes, in words: "DEV-67: status to Done; DEV-142: priority to Low". */
export const changeWords = (entries: ReadonlyArray<Said>): string =>
  entries.map((entry) => `${entry.key}: ${linesOf(entry).map(lineWords).join(', ')}`).join('; ')
