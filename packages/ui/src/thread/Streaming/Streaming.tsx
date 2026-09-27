import { useCallback, useEffect, useRef, useState } from 'react'

import { Streamed } from '../../primitives/Stream/Stream'
import { proseClass } from '../Turn/Turn'

/** The message being written now, in the thread's prose. With `loop`, it starts over a moment after it finishes, for catalogues. */
export function Streaming({ content, loop = false, id }: { content: string; loop?: boolean; id?: string }) {
  const [round, setRound] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const again = useCallback(() => {
    if (loop) timer.current = window.setTimeout(() => setRound((r) => r + 1), 2600)
  }, [loop])
  return <Streamed key={round} content={content} id={loop ? undefined : id} className={proseClass} onDone={again} />
}
