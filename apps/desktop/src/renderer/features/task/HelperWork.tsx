import { useQuery } from '@tanstack/react-query'

import type { ThreadItem } from '@althar/contracts'

import { useServices } from '../../data/services'
import s from './HelperWork.module.css'

/*
 * A helper's work, opened in place under its row in its lead's thread
 * (ADR-087, "In the thread"): what it said and what it ran, from its own
 * thread, the latest last, read again every few seconds while it is open.
 */

export const helperWorkText = {
  loading: 'Reading its work…',
  nothing: 'Nothing yet: it is starting.',
  failed: 'Its work couldn’t be read.',
  ran: (title: string) => `Ran ${title}`,
}

/** How many of its latest items it shows. */
const SHOWN = 40
/** How often it is read again while open. */
const EVERY = 3000

/** One of a helper's items as a line: what it said, the first lines; a tool it ran, by its title; what Althar said. */
const lineOf = (item: ThreadItem): string | null => {
  switch (item.kind) {
    case 'agent_message':
      return item.content.text.trim().split('\n').slice(0, 3).join(' ')
    case 'tool_call':
      return helperWorkText.ran(item.content.title)
    case 'notice':
      return item.content.title
    default:
      return null
  }
}

export function HelperWork({ threadId }: { threadId: string }) {
  const { client } = useServices()
  const read = useQuery({
    queryKey: ['helper-work', threadId],
    queryFn: () => client.getThread(threadId, { limit: SHOWN }),
    refetchInterval: EVERY,
  })
  if (read.isError) return <p className={s.work}>{helperWorkText.failed}</p>
  if (read.data === undefined) return <p className={s.work}>{helperWorkText.loading}</p>
  const lines = read.data.items.flatMap((item) => {
    const line = lineOf(item)
    return line === null || line === '' ? [] : [{ id: item.id, kind: item.kind, line }]
  })
  if (lines.length === 0) return <p className={s.work}>{helperWorkText.nothing}</p>
  return (
    <ol className={s.work} aria-label="Its work">
      {lines.map((one) => (
        <li key={one.id} className={one.kind === 'tool_call' ? s.ran : one.kind === 'notice' ? s.said : s.spoke}>
          {one.line}
        </li>
      ))}
    </ol>
  )
}
