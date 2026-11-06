// Scrappy: a task's header and its conversation's face, as the kit draws them, with one more face in B and D (Preview) and C (Compare).
// Picked, the task's own face stays on its conversation underneath, and the preview takes its place.
import { useEffect } from 'react'

import { TaskHeader as BuiltHeader, type TaskHeaderProps } from '../../../src/chrome/TaskHeader/TaskHeader'
import { TaskFace as BuiltFace, type TaskFaceProps } from '../../../src/thread/TaskFace/TaskFace'
import { Compare } from '../parts/Compare'
import { Preview } from '../parts/Preview'
import { proto, useProto } from '../state'

const FACE = 'preview'

export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  const p = useProto()
  const extra = p.direction !== 'A' && props.faces !== undefined
  // The preview takes the conversation's place: the task's own face goes there underneath, whatever it opened on.
  const { face: own, onFace } = props
  useEffect(() => {
    if (extra && p.face && own !== undefined && own !== 'talk') onFace?.('talk' as F)
  }, [extra, p.face, own, onFace])
  if (!extra) return <BuiltHeader {...props} />
  const face = FACE as F
  const faces = [...(props.faces ?? []), { value: face, label: p.direction === 'C' ? 'Compare' : 'Preview', kbd: 'p' }]
  return (
    <BuiltHeader
      {...props}
      faces={faces}
      face={p.face ? face : props.face}
      onFace={(picked) => {
        if (picked === face) {
          proto.set({ face: true })
          props.onFace?.('talk' as F)
        } else {
          proto.set({ face: false, pointing: null, draft: null })
          props.onFace?.(picked)
        }
      }}
    />
  )
}

export function TaskFace(props: TaskFaceProps) {
  const p = useProto()
  if (p.direction === 'A' || !p.face) return <BuiltFace {...props} />
  return p.direction === 'C' ? <Compare /> : <Preview />
}
