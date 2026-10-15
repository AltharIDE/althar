import { Allowed, AllowedBy } from '@althar/ui'

import { ruleWordsOf } from './permissions'
import type { Part } from './thread'

/*
 * What the project's allow rules let through in a turn, without asking
 * anyone (ADR-018): one quiet line under its work, which opens to each
 * command and the rule that let it through.
 */

export const text = {
  count: (n: number) => (n === 1 ? 'Allowed 1 request' : `Allowed ${n} requests`),
  who: (project: string) => (project === '' ? 'by the project’s rules' : `by ${project}’s rules`),
}

export function RuleReceipt({ parts, project = '' }: { parts: ReadonlyArray<Part>; project?: string }) {
  const items = parts.flatMap((part) =>
    part.kind === 'tool' && part.allowedBy !== undefined
      ? [{ id: part.id, cmd: part.command ?? part.target, by: AllowedBy.Rule as const, rule: ruleWordsOf(part.allowedBy) }]
      : [],
  )
  if (items.length === 0) return null
  return <Allowed items={items} project={project} text={{ allowedCount: text.count, allowedWho: () => text.who(project) }} />
}
