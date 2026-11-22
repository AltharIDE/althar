import { type ReactNode, useState } from 'react'

import { DEVICES } from '../../../src/main/browser/devices'
import type { Artifact, BoardDef } from '../artifacts'
import { ask, boardKey, boardsOf, live, useLive } from '../live'
import { Boards, type Placed, type Pointed, type Section, type Tool, type View } from './Boards'
import { drawnWidth } from './Board'
import { askInPin, PinCard, PinMarks } from './Pins'
import { Say } from './Say'
import s from './boards.module.css'

/*
 * One artifact as a canvas of boards, with what it takes to talk to it:
 * point at a part (or ring an area) and say what you think; the lead changes
 * the board in place, or draws takes beside it to keep one. Where what is
 * said goes is the direction's: the task's conversation (A, B), or a pin on
 * the part (D). Comments are pins for people. A guest, on a shared page,
 * only comments. An artifact with a lot of work in it shows every page at
 * once, a row each (C).
 */

/** Every page at once, a row each. */
export const EVERY_PAGE = 'every'

export interface Opening {
  readonly page?: string
  readonly view?: View
  /** The board one at a time shows: its id. */
  readonly focus?: string
  /** A part pointed at as it opens, its box open: on a board, by a selector. */
  readonly aim?: { readonly board: string; readonly selector: string } | null
  /** Where it starts: at a zoom, over a board. */
  readonly start?: { readonly zoom: number; readonly on: string } | null
  /** A pin open as it opens. */
  readonly pin?: string | null
}

export function ArtifactCanvas({
  artifact,
  talk,
  opening = {},
  head,
  lead,
  trail,
  close,
  guest = false,
}: {
  artifact: Artifact
  /** Where what is said to the lead goes: the task's conversation, or a pin on the part. */
  talk: 'conversation' | 'pin'
  /** How it opens. Keyed by its caller: a new opening starts it afresh. */
  opening?: Opening
  /** After the view's switch, in the canvas's head. */
  head?: ReactNode
  /** The canvas's head, floating on it: what it is, top left; its version, Share and the rest, top right; closing it. */
  lead?: ReactNode
  trail?: ReactNode
  close?: ReactNode
  /** On a shared page: comments, nothing to the lead. */
  guest?: boolean
}) {
  const world = useLive()
  const [page, setPage] = useState(opening.page ?? artifact.pages[0]?.id ?? '')
  const [view, setView] = useState<View>(opening.view ?? 'every')
  const [focus, setFocus] = useState<string | null>(opening.focus === undefined ? null : boardKey(artifact.id, opening.focus))
  const [pointed, setPointed] = useState<Pointed | null>(null)
  const [pin, setPin] = useState<string | null>(opening.pin ?? null)
  const [tool, setTool] = useState<Tool>(guest ? 'comment' : 'point')
  const [frame, setFrame] = useState<ReadonlyArray<string> | null>(null)
  // Takes the lead drew beside a board: every board, framed on it and them.
  const showTakes = (from: BoardDef) => (takes: ReadonlyArray<BoardDef> | undefined) => {
    if (takes === undefined) return
    setView('every')
    setFrame([boardKey(artifact.id, from.id), ...takes.map((one) => boardKey(artifact.id, one.id))])
  }

  const every = page === EVERY_PAGE
  const sections: ReadonlyArray<Section> = every
    ? artifact.pages.map((one) => {
        const these = boardsOf(world, artifact, one.id)
        return {
          key: one.id,
          artifact,
          pageId: one.id,
          boards: these,
          heading: { title: one.name, facts: these.length === 1 ? '1 board' : `${these.length} boards`, onOpen: () => setPage(one.id) },
        }
      })
    : [{ key: page, artifact, pageId: page, boards: boardsOf(world, artifact, page) }]
  const boards = sections.flatMap((one) => one.boards)
  /** The page a board is on, for what the lead draws beside it. */
  const pageOf = (boardId: string) => sections.find((one) => one.boards.some((b) => b.id === boardId))?.pageId ?? page
  const own = artifact.pages.map((one) => ({ id: one.id, name: one.name, count: boardsOf(world, artifact, one.id).length }))
  const pages = own.length > 1 ? [{ id: EVERY_PAGE, name: 'Every page', count: boards.length }, ...own] : own
  const onPage = new Set(boards.map((one) => one.id))
  const pins = world.pins.filter((one) => one.spot.artifactId === artifact.id && onPage.has(one.spot.boardId))
  const openPin = pins.find((one) => one.id === pin) ?? null
  const to = talk === 'pin' ? 'Stays on a pin, with the lead’s answer' : 'To the lead, in the conversation'

  const send = (from: Pointed, words: string) => {
    setPointed(null)
    const on = pageOf(from.placed.def.id)
    if (talk === 'pin') setPin(askInPin(artifact, from.placed.def, on, from.spot, words, null, showTakes(from.placed.def)))
    else ask(artifact, from.placed.def, on, from.spot, words, (answer) => showTakes(from.placed.def)(answer.takes))
  }
  const comment = (from: Pointed, words: string) => {
    const id = `pin-${Date.now().toString(36)}`
    live.pin({ id, spot: from.spot, who: guest ? 'Sam' : 'you', lines: [{ who: 'you', text: words }], state: 'comment' })
    setPointed(null)
    if (talk === 'pin' || guest) setPin(id)
  }
  // A take kept: its look lands on the board it was drawn from, as the next version, and the other takes go.
  const keep = (take: Placed) => {
    const from = take.def.from
    const was = boards.find((one) => one.id === from)
    if (from === undefined || was === undefined) return
    const version = live.land(artifact, from, { look: take.def.look ?? {} }, `kept ${take.def.name}`)
    live.remove(
      artifact.id,
      pageOf(from),
      boards.filter((one) => one.from === from).map((one) => one.id),
    )
    live.say({
      who: 'lead',
      text: `**v${version}** of ${artifact.title}: kept **${take.def.name}** on ${was.name}. The other takes are gone.`,
      version,
    })
    setFocus(boardKey(artifact.id, from))
    setFrame(null)
  }

  return (
    <div
      className={s.host}
      tabIndex={-1}
      onKeyDown={(event) => {
        // The canvas takes Escape first, for what is open on it or one board at a time; then it closes the panel around it.
        if (event.key === 'Escape' && (pointed !== null || pin !== null || view === 'one')) {
          event.preventDefault()
          if (pointed !== null) setPointed(null)
          else if (pin !== null) setPin(null)
        }
      }}
    >
      <Boards
        sections={sections}
        pages={pages}
        page={page}
        onPage={(id) => {
          setPage(id)
          setPointed(null)
          setPin(null)
        }}
        view={view}
        onView={setView}
        focus={focus}
        onFocus={setFocus}
        head={head}
        lead={lead}
        trail={trail}
        close={close}
        tool={tool}
        onTool={setTool}
        fitKey={`${artifact.id}|${page}|${boards.length}`}
        start={
          opening.start === undefined || opening.start === null
            ? null
            : { zoom: opening.start.zoom, on: boardKey(artifact.id, opening.start.on) }
        }
        frame={frame}
        aim={
          opening.aim === undefined || opening.aim === null
            ? null
            : { key: boardKey(artifact.id, opening.aim.board), selector: opening.aim.selector }
        }
        onPoint={(found) => {
          setPin(null)
          setPointed(guest ? { ...found, tool: 'comment' } : found)
        }}
        pointed={pointed}
        box={
          pointed !== null && (
            <Say
              key={`${pointed.key}|${pointed.spot.selector ?? ''}|${pointed.tool}`}
              pointed={pointed}
              to={to}
              lead={!guest}
              onSend={(words) => send(pointed, words)}
              onComment={(words) => comment(pointed, words)}
              onClose={() => setPointed(null)}
            />
          )
        }
        marks={(at, _placed, room) => {
          const shown =
            openPin === null ? null : at(boardKey(openPin.spot.artifactId, openPin.spot.boardId), openPin.spot.selector ?? openPin.spot.box)
          const board = openPin === null ? undefined : boards.find((one) => one.id === openPin.spot.boardId)
          return (
            <>
              <PinMarks at={at} pins={pins} open={pin} onOpen={(id) => (setPointed(null), setPin(id))} />
              {openPin !== null && shown !== null && board !== undefined && (
                <div
                  className={s.boxPlace}
                  style={{
                    width: 340,
                    left: shown.x + shown.width + 24 + 340 < room.width ? shown.x + shown.width + 24 : Math.max(12, shown.x - 340 - 16),
                    top: Math.max(56, Math.min(shown.y - 14, room.height - 460)),
                  }}
                >
                  <PinCard
                    key={openPin.id}
                    pin={openPin}
                    board={board.name}
                    talk={guest ? 'conversation' : talk}
                    onAsk={(words) => {
                      if (guest) return
                      const on = pageOf(board.id)
                      if (talk === 'pin') askInPin(artifact, board, on, openPin.spot, words, openPin.id, showTakes(board))
                      else ask(artifact, board, on, openPin.spot, words, (answer) => showTakes(board)(answer.takes))
                    }}
                    onClose={() => setPin(null)}
                  />
                </div>
              )}
            </>
          )
        }}
        labelEnd={(p) =>
          p.def.tried !== undefined && !guest ? (
            <button type="button" className={s.keep} data-keep onClick={() => keep(p)}>
              Keep
            </button>
          ) : null
        }
      />
    </div>
  )
}

/** How wide a board is laid out, for what draws one outside the canvas. */
export const laidWidth = (artifact: Artifact) => {
  const def = artifact.pages[0]?.boards[0]
  if (def === undefined) return 1280
  return def.draw === undefined ? DEVICES[def.size ?? 'laptop'].width : drawnWidth(def)
}
