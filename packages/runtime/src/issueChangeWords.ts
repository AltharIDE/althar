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
  if (line.field === 'labels')
    return `labels ${[...line.add.map((label) => `+${label}`), ...line.remove.map((label) => `−${label}`)].join(' ')}`
  switch (line.field) {
    case 'close':
      return 'closed'
    case 'assignee':
      return line.to === null ? 'unassigned' : `assigned to ${line.to}`
    case 'project':
      return line.to === null ? 'out of its project' : `project to ${line.to}`
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
}

/** What one issue's change says, in a line: the card's, and what agents hear. */
export const linesOf = (entry: Omit<Said, 'key'>): ReadonlyArray<IssueChangeLine> => {
  const { change: wanted } = entry
  return [
    ...(wanted.status === undefined ? [] : [{ field: 'status' as const, to: wanted.status.name }]),
    ...(wanted.close === true ? [{ field: 'close' as const, to: null }] : []),
    ...(wanted.priority === undefined ? [] : [{ field: 'priority' as const, to: PRIORITY_WORDS[wanted.priority] }]),
    ...(wanted.assignee === undefined ? [] : [{ field: 'assignee' as const, to: wanted.assignee?.name ?? null }]),
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
    ...(wanted.title === undefined ? [] : [{ field: 'title' as const, to: wanted.title }]),
    ...(entry.comment === undefined ? [] : [{ field: 'comment' as const, to: entry.comment }]),
    ...(entry.link === undefined ? [] : [{ field: 'link' as const, to: entry.link.url }]),
  ]
}

/** What a card changes, in words: "DEV-67: status to Done; DEV-142: priority to Low". */
export const changeWords = (entries: ReadonlyArray<Said>): string =>
  entries.map((entry) => `${entry.key}: ${linesOf(entry).map(lineWords).join(', ')}`).join('; ')
