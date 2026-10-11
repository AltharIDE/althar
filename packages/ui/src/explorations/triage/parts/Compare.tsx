import { Markdown } from '../../../thread/Markdown/Markdown'
import { draw as drawA, NOTES as notesA } from '../A/draw'
import { draw as drawB, NOTES as notesB } from '../B/draw'
import { draw as drawC, NOTES as notesC } from '../C/draw'
import { draw as drawD, NOTES as notesD } from '../D/draw'
import { PR_ASSUMED, PR_NOTHING } from '../world'
import { Moments, type Moment } from './Moments'
import { momentsOf, type Draw, type MomentId } from './sheet'

/* For the comparison page: one moment, drawn by each direction in turn, and the pull request's end. */

const DIRECTIONS: readonly { name: string; draw: Draw; notes: Partial<Record<MomentId, string>> }[] = [
  { name: 'A. Plan-like card', draw: drawA, notes: notesA },
  { name: 'B. Inline line', draw: drawB, notes: notesB },
  { name: 'C. Board-first', draw: drawC, notes: notesC },
  { name: 'D. On the brief', draw: drawD, notes: notesD },
]

export function SameMoment({ id, dark = false }: { id: MomentId; dark?: boolean }) {
  const moments = DIRECTIONS.flatMap((d): Moment[] => {
    const m = momentsOf(d.draw, d.notes).find((x) => x.id === id)
    return m ? [{ ...m, id: `${d.name}-${id}`, state: d.name }] : []
  })
  return (
    <div className="ch-root">
      <Moments moments={moments} dark={dark} narrow />
    </div>
  )
}

export function PullRequestEnd({ nothing = false }: { nothing?: boolean }) {
  return (
    <div className="ch-root" style={{ maxWidth: 640, padding: '4px 20px', borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
      <Markdown source={nothing ? PR_NOTHING : PR_ASSUMED} headingLevel={3} />
    </div>
  )
}
