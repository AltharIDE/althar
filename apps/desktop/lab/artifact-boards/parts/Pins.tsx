import { useEffect, useRef, useState } from 'react'

import { Button, IconButton, Markdown } from '@althar/ui'

import type { Artifact, BoardDef } from '../artifacts'
import { answerTo, ask, boardKey, type Line, live, type Pin, type Spot } from '../live'
import type { At } from './Boards'
import s from './pins.module.css'

/*
 * Pins: what people said about a part, where they said it. In A and B a pin
 * is a comment for people, which the lead reads too; asking the lead from
 * one goes to the conversation. In D a pin is the conversation: what you say
 * to the lead about a part stays on it, with its answer and the version it
 * made, and the task's conversation gets a line for each change.
 */

const INK: Readonly<Record<Pin['who'], string>> = { you: 'indigo', Sam: 'teal', Lee: 'plum', Ana: 'ochre' }
const nameOf = (who: Pin['who']) => (who === 'you' ? 'You' : who)

/** In D: what is said to the lead about a part, kept on its pin; the change lands, and the conversation hears of it. */
export const askInPin = (
  artifact: Artifact,
  board: BoardDef,
  pageId: string,
  spot: Spot,
  words: string,
  pinId: string | null = null,
  then?: (takes: ReadonlyArray<BoardDef> | undefined) => void,
) => {
  const id = pinId ?? `pin-${Date.now().toString(36)}`
  const was = live.get().pins.find((one) => one.id === id)
  live.pin({ id, spot, who: was?.who ?? 'you', lines: [...(was?.lines ?? []), { who: 'you', text: words }], state: 'working' })
  live.work(spot)
  window.setTimeout(() => {
    const answer = answerTo(spot, words, board)
    let version: number | null = null
    if (answer.takes !== undefined) live.add(artifact.id, pageId, answer.takes)
    if (answer.change !== undefined) version = live.land(artifact, board.id, answer.change, answer.note)
    live.work(null)
    const note = answer.note.charAt(0).toUpperCase() + answer.note.slice(1)
    const now = live.get().pins.find((one) => one.id === id)
    if (now !== undefined)
      live.pin({
        ...now,
        lines: [...now.lines, version === null ? { who: 'lead', text: note } : { who: 'lead', text: `**v${version}.** ${note}`, version }],
        state: 'changed',
        ...(version === null ? {} : { version }),
      })
    then?.(answer.takes)
    if (version !== null)
      live.say({
        who: 'lead',
        text: `**v${version}** of ${artifact.title}, from a pin on ${spot.label.replace(/^The /, 'the ')}: ${answer.note}`,
        version,
      })
  }, 2200)
  return id
}

export function PinMarks({
  at,
  pins,
  open,
  onOpen,
}: {
  at: At
  pins: ReadonlyArray<Pin>
  open: string | null
  onOpen: (id: string | null) => void
}) {
  return (
    <>
      {pins.map((pin, i) => {
        const key = boardKey(pin.spot.artifactId, pin.spot.boardId)
        // A part is found where it is now, once its board has drawn; until then its pin waits.
        const box = pin.spot.selector !== null ? at(key, pin.spot.selector) : at(key, pin.spot.box)
        if (box === null) return null
        return (
          <button
            key={pin.id}
            type="button"
            className={s.pin}
            data-ink={INK[pin.who]}
            data-state={pin.state}
            aria-pressed={open === pin.id}
            aria-label={`${nameOf(pin.who)} on ${pin.spot.label}`}
            style={{ left: box.x + box.width - 10, top: box.y - 14 }}
            onClick={() => onOpen(open === pin.id ? null : pin.id)}
          >
            {pin.state === 'working' ? <span className={s.pinDots} aria-hidden /> : pin.who === 'you' ? i + 1 : pin.who[0]}
          </button>
        )
      })}
    </>
  )
}

/** A pin, open: who said what about the part, the lead's answers and the versions they made, and a reply. */
export function PinCard({
  pin,
  board,
  talk,
  onAsk,
  onClose,
}: {
  pin: Pin
  board: string
  /** Where the lead's answers are: in the pin itself (D), or in the conversation (A, B). */
  talk: 'pin' | 'conversation'
  onAsk: (words: string) => void
  onClose: () => void
}) {
  const [words, setWords] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [pin.id])
  const said = words.trim()
  const reply = (line: Line) => {
    live.pin({ ...pin, lines: [...pin.lines, line] })
    setWords('')
  }
  return (
    <div
      className={s.card}
      role="dialog"
      aria-label={`On ${pin.spot.label}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className={s.cardHead}>
        <span className={s.cardOn}>{pin.spot.label}</span>
        <span className={s.cardWhere}>{board}</span>
        {pin.state !== 'resolved' && (
          <Button size="small" variant="quiet" onClick={() => live.pin({ ...pin, state: 'resolved' })}>
            Resolve
          </Button>
        )}
        <IconButton icon="close" label="Close" size="small" onClick={onClose} />
      </div>
      <ol className={s.lines}>
        {pin.lines.map((line, i) => {
          const who = line.who === 'lead' ? 'lead' : i === 0 ? pin.who : 'you'
          return (
            <li key={i} className={s.line}>
              <span className={s.face} data-ink={who === 'lead' ? 'lead' : INK[who]} aria-hidden>
                {who === 'lead' ? '✳' : who === 'you' ? 'Y' : who[0]}
              </span>
              <span className={s.lineBody}>
                <span className={s.lineWho}>{who === 'lead' ? 'Lead of Gift a class' : nameOf(who)}</span>
                <Markdown source={line.text} size="panel" />
              </span>
            </li>
          )
        })}
        {pin.state === 'working' && (
          <li className={s.line}>
            <span className={s.face} data-ink="lead" aria-hidden>
              ✳
            </span>
            <span className={s.lineBody}>
              <span className={s.lineWho}>Lead of Gift a class</span>
              <span className={s.working}>Changing it on the board</span>
            </span>
          </li>
        )}
      </ol>
      <div className={s.reply}>
        <textarea
          ref={field}
          className={s.field}
          rows={1}
          value={words}
          placeholder={talk === 'pin' ? 'Say what you think, or reply' : 'Reply'}
          aria-label="Reply"
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && said !== '') {
              event.preventDefault()
              if (talk === 'pin') onAsk(said)
              else reply({ who: 'you', text: said })
              setWords('')
            }
          }}
        />
        <div className={s.replyFoot}>
          <span className={s.replyTo}>{talk === 'pin' ? 'The lead answers here' : 'People on kiln see it'}</span>
          {talk === 'pin' ? (
            <>
              <Button size="small" variant="quiet" disabled={said === ''} onClick={() => reply({ who: 'you', text: said })}>
                Reply only
              </Button>
              <Button
                size="small"
                variant="signal"
                disabled={said === '' && (pin.who === 'you' || pin.state !== 'comment')}
                onClick={() => {
                  onAsk(said === '' ? `Do what ${pin.who} says: ${pin.lines[0]?.text ?? ''}` : said)
                  setWords('')
                }}
              >
                {said === '' && pin.who !== 'you' && pin.state === 'comment' ? 'Ask the lead to do it' : 'Send'}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="small"
                variant="quiet"
                onClick={() => {
                  onAsk(said === '' ? (pin.lines[0]?.text ?? '') : said)
                  setWords('')
                }}
              >
                Ask the lead
              </Button>
              <Button size="small" variant="signal" disabled={said === ''} onClick={() => reply({ who: 'you', text: said })}>
                Reply
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** In A and B: asking the lead from a pin goes to the conversation, as pointing does. */
export const askFromPin = (artifact: Artifact, board: BoardDef, pageId: string, pin: Pin, words: string) =>
  ask(artifact, board, pageId, pin.spot, words)
