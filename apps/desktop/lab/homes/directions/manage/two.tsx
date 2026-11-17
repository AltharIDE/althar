import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, CopyButton, Dialog, Icon } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Glyph, Target, useHomes } from '../parts'
import {
  ConnectionFields,
  Forgotten,
  inked,
  LiveDot,
  type Liveness,
  type ManageProps,
  NameField,
  openFrom,
  useEdit,
  useForget,
  useLiveness,
  useStatus,
} from './shared'
import s from './two.module.css'

/*
 * Manage 2 · Orbit. This computer in the middle, its homes around it, each
 * tied to it by its connection as it stands: packets running down the line
 * while a window is connected, a broken red line where it dropped, a faint
 * dotted one for a home that's saved and resting. Picking a home turns the
 * orbit to bring it forward, beside its card: the name changed in place, its
 * connection, its identity, Forget. Connect a home is the empty place in the
 * orbit where the next one goes.
 */

/** The map's height, and the orbit's: wide while resting, drawn in to the left beside a picked home's card. */
const H = 372
const CY = 182
const RY = 110
const shape = (width: number, picked: boolean) => (picked ? { cx: 62 + 86, rx: 86 } : { cx: width / 2, rx: Math.min(width / 2 - 70, 236) })

interface Pose {
  readonly turn: number
  readonly cx: number
  readonly rx: number
}
/** A slight overshoot, settling: the kit's slide, as a function for a tween. */
const slide = (k: number) => 1 + 1.6 * (k - 1) ** 3 + 0.6 * (k - 1) ** 2
/** The orbit's pose, moved toward where it's going a frame at a time, so every place stays on the ellipse. At once with reduced motion. */
const usePose = ({ turn, cx, rx }: Pose): Pose => {
  const [pose, setPose] = useState({ turn, cx, rx })
  const now = useRef(pose)
  useEffect(() => {
    const want = { turn, cx, rx }
    const from = now.current
    if (from.turn === want.turn && from.cx === want.cx && from.rx === want.rx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      now.current = want
      setPose(want)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (time: number) => {
      const k = Math.min(1, (time - start) / 406)
      const e = slide(k)
      const next = {
        turn: from.turn + (want.turn - from.turn) * e,
        cx: from.cx + (want.cx - from.cx) * e,
        rx: from.rx + (want.rx - from.rx) * e,
      }
      now.current = next
      setPose(next)
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [turn, cx, rx])
  return pose
}

interface Point {
  readonly x: number
  readonly y: number
}

export function OrbitManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const places = [...shown.map((one) => one.id), 'add']
  const angleOf = (id: string) => (360 / places.length) * places.indexOf(id) - 90
  // The orbit turns the short way round until the picked home is at its right, nearest its card.
  const turnTo = (id: string, was: number) => {
    const want = -angleOf(id)
    return was + ((((want - was) % 360) + 540) % 360) - 180
  }
  const [picked, setPicked] = useState<string | null>(opening.pick)
  const [turn, setTurn] = useState(() => (opening.pick === null ? 0 : turnTo(opening.pick, 0)))
  const [editing, setEditing] = useState(false)
  const home = shown.find((one) => one.id === picked)
  const map = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(592)
  useLayoutEffect(() => {
    const el = map.current
    if (el === null) return
    const seen = new ResizeObserver(([entry]) => entry !== undefined && setWidth(entry.contentRect.width))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  const pick = (id: string | null) => {
    setEditing(false)
    setPicked(id)
    if (id !== null) setTurn((was) => turnTo(id, was))
  }
  const pose = usePose({ turn, ...shape(width, home !== undefined) })
  const point = (id: string): Point => {
    const a = ((angleOf(id) + pose.turn) * Math.PI) / 180
    return { x: pose.cx + Math.cos(a) * pose.rx, y: CY + Math.sin(a) * RY }
  }
  const centre = { x: pose.cx, y: CY }
  const local = windowId === 'local'
  const add = point('add')
  return (
    <Dialog title="Homes" width={640} onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <div
        className={s.map}
        ref={map}
        style={{ height: H }}
        data-picked={home !== undefined || undefined}
        onClick={(event) => {
          if (event.target === event.currentTarget) pick(null)
        }}
      >
        <svg className={s.links} width={width} height={H} aria-hidden="true">
          {shown.map((one) => (
            <Link key={one.id} home={one} from={point(one.id)} to={centre} lit={picked === null || picked === one.id} />
          ))}
          <line className={s.addLink} {...ends(add, centre)} />
        </svg>
        <div className={s.place} style={{ transform: `translate(${centre.x}px, ${centre.y}px)` }}>
          <div className={s.me} data-here={local || undefined}>
            <span className={s.meDisc}>
              <Glyph kind="local" size={22} />
            </span>
            <span className={s.nodeName}>This computer</span>
            {local && <span className={s.nodeWhen}>This window</span>}
          </div>
        </div>
        {shown.map((one) => (
          <Node key={one.id} home={one} windowId={windowId} at={point(one.id)} picked={picked} onPick={() => pick(one.id)} />
        ))}
        <div className={s.place} style={{ transform: `translate(${add.x}px, ${add.y}px)` }}>
          <button type="button" className={`${s.node} ${s.addNode}`} data-above={add.y < CY - 40 || undefined} onClick={onConnect}>
            <span className={s.disc}>
              <Icon name="plus" size={16} />
            </span>
            <span className={s.nodeName}>Connect a home</span>
          </button>
        </div>
        {home !== undefined && (
          <Card
            key={home.id}
            home={home}
            homes={homes}
            windowId={windowId}
            editing={editing}
            onEdit={setEditing}
            onClose={onClose}
            onForget={() => {
              pick(null)
              forgetting.forget(home, saved.indexOf(home))
            }}
          />
        )}
      </div>
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

/** A tie between a home and this computer, from the edge of one disc to the edge of the other. */
const ends = (from: Point, to: Point, near = 25, far = 33) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x1: from.x + (dx / length) * near,
    y1: from.y + (dy / length) * near,
    x2: to.x - (dx / length) * far,
    y2: to.y - (dy / length) * far,
  }
}

/** A home's tie to this computer, drawn as its connection stands. */
function Link({ home, from, to, lit }: { home: LabHome; from: Point; to: Point; lit: boolean }) {
  const live: Liveness = useLiveness(home)
  const { x1, y1, x2, y2 } = ends(from, to)
  const path = `M${x1} ${y1}L${x2} ${y2}`
  const along = (k: number) => ({ x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k })
  const gapA = along(0.4)
  const gapB = along(0.6)
  const mid = along(0.5)
  return (
    <g className={s.link} data-state={live} data-lit={lit || undefined} style={inked(home.homeId)}>
      {live === 'down' ? (
        <>
          <line x1={x1} y1={y1} x2={gapA.x} y2={gapA.y} />
          <line x1={gapB.x} y1={gapB.y} x2={x2} y2={y2} />
          <g className={s.cut} transform={`translate(${mid.x} ${mid.y})`}>
            <line x1={-4} y1={-4} x2={4} y2={4} />
            <line x1={4} y1={-4} x2={-4} y2={4} />
          </g>
        </>
      ) : (
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
      )}
      {live === 'live' &&
        [0, 0.8, 1.6].map((begin) => (
          <circle key={begin} r={2.6} className={s.packet}>
            <animateMotion dur="2.4s" begin={`${begin}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
    </g>
  )
}

function Node({
  home,
  windowId,
  at,
  picked,
  onPick,
}: {
  home: LabHome
  windowId: string
  at: Point
  picked: string | null
  onPick: () => void
}) {
  const status = useStatus(home, windowId)
  const live = useLiveness(home)
  return (
    <div className={s.place} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
      <button
        type="button"
        className={s.node}
        style={inked(home.homeId)}
        data-above={at.y < CY - 40 || undefined}
        title={picked !== null && picked !== home.id ? home.name : undefined}
        aria-pressed={picked === home.id}
        data-dim={(picked !== null && picked !== home.id) || undefined}
        data-here={home.id === windowId || undefined}
        onClick={onPick}
      >
        <span className={s.disc}>
          <Glyph kind={live === 'down' ? 'down' : 'home'} size={19} />
          <LiveDot state={live} className={s.nodeDot} />
        </span>
        <span className={s.nodeName}>{home.name}</span>
        <span className={s.nodeWhen} data-down={status.down || undefined}>
          {status.words}
        </span>
      </button>
    </div>
  )
}

/** The picked home, beside it: grown from its side of the orbit. */
function Card({
  home,
  homes,
  windowId,
  editing,
  onEdit,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  editing: boolean
  onEdit: (on: boolean) => void
  onClose: () => void
  onForget: () => void
}) {
  const edit = useEdit(homes, home)
  const here = home.id === windowId
  return (
    <div className={s.card} style={inked(home.homeId)} role="group" aria-label={home.name}>
      <NameField home={home} className={s.cardName} />
      <Target home={home} />
      {editing ? (
        <div className={s.cardEdit}>
          <ConnectionFields edit={edit} home={home} />
          {!edit.dirty && (
            <Button size="small" onClick={() => onEdit(false)} className={s.done}>
              Done
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className={s.cardId}>
            <code>{home.homeId}</code>
            <CopyButton value={home.homeId} />
          </div>
          <div className={s.cardActions}>
            <Button size="small" icon="plug" onClick={() => onEdit(true)}>
              Edit connection
            </Button>
            {!here && (
              <Button size="small" onClick={() => openFrom(homes, home.id, onClose)}>
                Open
              </Button>
            )}
          </div>
          <Button size="small" variant="quiet" icon="remove" className={s.forget} onClick={onForget}>
            Forget
          </Button>
        </>
      )}
    </div>
  )
}
