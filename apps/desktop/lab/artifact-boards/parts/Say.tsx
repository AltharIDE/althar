import { useEffect, useRef, useState } from 'react'

import { Button, IconButton } from '@althar/ui'

import { STARTERS } from '../live'
import type { Pointed } from './Boards'
import s from './parts.module.css'

/*
 * The box on what was pointed at: say what you think, and the agent changes
 * it. Starters for when you can't say why yet send at once. Comment leaves
 * a note on the part for people, which the agent reads too; with the
 * Comment tool, that is what it does first.
 */

export function Say({
  pointed,
  to,
  onSend,
  onComment,
  onClose,
  initial = '',
  lead = true,
}: {
  pointed: Pointed
  /** Who what is said goes to, in a few words: “The lead of Gift a class”. */
  to: string
  onSend: (words: string) => void
  onComment?: (words: string) => void
  onClose: () => void
  initial?: string
  /** Whether what is said can go to the lead: not from a shared page, where a guest comments. */
  lead?: boolean
}) {
  const [words, setWords] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(initial.length, initial.length)
  }, [initial])
  const commenting = pointed.tool === 'comment' || !lead
  const said = words.trim()
  const send = () => {
    if (said === '') return
    if (commenting && onComment !== undefined) onComment(said)
    else onSend(said)
  }
  return (
    <div
      className={s.say}
      role="dialog"
      aria-label={`About ${pointed.spot.label}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className={s.sayHead}>
        <span className={s.sayOn}>{pointed.spot.label}</span>
        <span className={s.sayWhere}>{pointed.placed.def.name}</span>
        <IconButton icon="close" label="Close" size="small" onClick={onClose} />
      </div>
      <textarea
        ref={field}
        className={s.sayField}
        rows={2}
        value={words}
        placeholder={commenting ? 'Comment for the people on it' : 'Say what you think'}
        aria-label={commenting ? 'Comment' : 'What you think'}
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
      />
      {!commenting && said === '' && (
        <div className={s.starters} aria-label="Can't say why yet">
          {STARTERS.map((one) => (
            <button key={one} type="button" className={s.starter} onClick={() => onSend(one)}>
              {one}
            </button>
          ))}
        </div>
      )}
      <div className={s.sayFoot}>
        <span className={s.sayTo}>
          {!lead ? 'Kiln’s team sees it beside their design' : commenting ? 'People on kiln see it, and the lead reads it' : to}
        </span>
        {onComment !== undefined && !commenting && (
          <Button size="small" variant="quiet" disabled={said === ''} onClick={() => onComment(said)}>
            Comment
          </Button>
        )}
        {commenting && lead && (
          <Button size="small" variant="quiet" disabled={said === ''} onClick={() => onSend(said)}>
            Ask the lead
          </Button>
        )}
        <Button size="small" variant="signal" disabled={said === ''} onClick={send}>
          {commenting ? 'Comment' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
