// Scrappy: E's comments, as chips in the composer: each with its crop small where a file's glyph would be, its card on hover,
// and, clicked, the comment open again on the page. Laid into the composer's own chips; built, the kit's chip would take a picture
// and a card of its own.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { HoverCard } from '../../../src/primitives/HoverCard/HoverCard'
import { type Comment, proto } from '../state'
import { CommentCard, cropSrc } from './CommentCard'
import s from './Chips.module.css'

export function Chips({ comments, children }: { comments: ReadonlyArray<Comment>; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [chips, setChips] = useState<ReadonlyMap<string, Element>>(new Map())
  const ids = comments.map((one) => one.id).join(' ')
  // The composer's chips, found again as it draws them: they come and go as comments do.
  useEffect(() => {
    const root = host.current
    if (root === null) return
    const scan = () =>
      setChips((was) => {
        const found = new Map<string, Element>()
        for (const id of ids.split(' ')) {
          const chip = root.querySelector(`li[data-move="${id}"]`)
          if (chip !== null) found.set(id, chip)
        }
        const same = found.size === was.size && [...found].every(([id, chip]) => was.get(id) === chip)
        return same ? was : found
      })
    const watching = new MutationObserver(scan)
    watching.observe(root, { childList: true, subtree: true })
    scan()
    return () => watching.disconnect()
  }, [ids])
  return (
    <div ref={host} className={s.host}>
      {children}
      {comments.map((one, at) => {
        const chip = chips.get(one.id)
        if (chip === undefined) return null
        return createPortal(
          <>
            {typeof one.crop === 'object' && <img className={s.thumb} src={cropSrc(one.crop.digest)} alt="" />}
            <HoverCard placement="above" align="start" width={340} card={<CommentCard comment={one} n={at + 1} />}>
              <button type="button" className={s.over} aria-label={`Comment ${at + 1}: ${one.note}`} onClick={() => proto.edit(one.id)} />
            </HoverCard>
          </>,
          chip,
          one.id,
        )
      })}
    </div>
  )
}
