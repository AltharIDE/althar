// Scrappy: the pieces a thread's marks stand for, beyond surface 2's, by the surface and direction shown.
import { ActCard, Seen } from './tools/Calls'
import { Batch, FastLane, ServerFails } from './parts/More'
import { ChildFailed, Lighter, NeverMet, SameFiles } from './situations/Situations'
import { Origin, ReviewHead, SelfPush } from './parts/Sketches'
import { Loosen, SettingsChanges } from './tune/Tune'
import { useProto } from '../state'

export function Marked({ mark }: { mark: string }) {
  const p = useProto()
  const tools = p.surface === 'tools' && p.direction !== 'Today'
  if (mark === '§seen') return tools ? <Seen agent="Claude Code" /> : null
  if (mark.startsWith('§act-')) return tools ? <ActCard mark={mark} /> : null
  if (mark === '§origin') return p.surface === 'lineage' && p.direction !== 'Today' ? <Origin /> : null
  if (mark === '§selfpush') return p.surface === 'sketches' ? <SelfPush /> : null
  if (mark === '§reviewhead') return p.surface === 'sketches' ? <ReviewHead outside /> : null
  const sketch = p.surface === 'sketches'
  if (mark === '§fast') return sketch ? <FastLane /> : null
  if (mark === '§mcpfail') return sketch ? <ServerFails /> : null
  if (mark === '§batch') return sketch ? <Batch /> : null
  const situation = p.surface === 'situations'
  if (mark === '§never') return situation ? <NeverMet /> : null
  if (mark === '§childfail') return situation ? <ChildFailed /> : null
  if (mark === '§samefiles') return situation ? <SameFiles /> : null
  if (mark === '§lighter') return situation ? <Lighter /> : null
  const tune = p.surface === 'tune' && p.direction !== 'Today'
  if (mark === '§tune-changes') return tune ? <SettingsChanges /> : null
  if (mark === '§tune-loosen') return tune ? <Loosen /> : null
  return null
}
