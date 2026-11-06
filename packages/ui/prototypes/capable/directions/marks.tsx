// Scrappy: the pieces a thread's marks stand for, beyond surface 2's, by the surface and direction shown.
import { ActCard, ActLine, Seen } from './tools/Calls'
import { Origin, ReviewHead, SelfPush } from './parts/Sketches'
import { useProto } from '../state'

export function Marked({ mark }: { mark: string }) {
  const p = useProto()
  const tools = p.surface === 'tools' && p.direction !== 'Today'
  if (mark === '§seen') return tools ? <Seen agent="Claude Code" /> : null
  if (mark.startsWith('§act-')) return tools ? p.direction === 'B' ? <ActCard mark={mark} /> : <ActLine mark={mark} /> : null
  if (mark === '§origin') return p.surface === 'lineage' && p.direction !== 'Today' ? <Origin /> : null
  if (mark === '§selfpush') return p.surface === 'parts' ? <SelfPush /> : null
  if (mark === '§reviewhead') return p.surface === 'parts' ? <ReviewHead outside /> : null
  return null
}
