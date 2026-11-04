// Scrappy: a task's header as built; in B, Outputs is Where it stands, first, and the task opens on it even with a call waiting.
import { type ComponentProps, useEffect, useRef } from 'react'

import { TaskHeader as Built } from '../../../src/index'
import { useProto } from '../state'

type Props = ComponentProps<typeof Built>

export function TaskHeader(props: Props) {
  const { direction, opening } = useProto()
  const opened = useRef(false)
  const { face, onFace } = props
  useEffect(() => {
    if (direction !== 'B' || opened.current) return
    opened.current = true
    const want = opening.talk ? 'talk' : 'out'
    if (face !== want) onFace?.(want as never)
  }, [direction, face, onFace, opening.talk])
  if (direction !== 'B' || props.faces === undefined) return <Built {...props} />
  const faces = [
    ...props.faces.filter((one) => one.value === 'out').map((one) => ({ ...one, label: 'Where it stands' })),
    ...props.faces.filter((one) => one.value !== 'out'),
  ]
  return <Built {...props} faces={faces} />
}
