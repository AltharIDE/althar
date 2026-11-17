import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react'
import { Button, Dialog, Icon, ListMotion } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Target, useHomes } from '../parts'
import {
  ConnectionFields,
  Forgotten,
  Identity,
  inkOf,
  LiveDot,
  type ManageProps,
  NameField,
  openFrom,
  useEdit,
  useForget,
  useLiveness,
  useStatus,
} from './shared'
import s from './three.module.css'

/*
 * Manage 3 · Keycards. Each home is a card in a deck: a band in its colour,
 * striped its own way, with its initials; its name, host and how it stands
 * beneath; Edit and Open along its foot. A card leans toward the pointer.
 * Edit turns it over: its back is the name, the connection and the identity,
 * with Forget; Done turns it back. Forget lets the card drop out of the
 * deck, and the rest close up behind it, with Undo. A blank card at the end
 * is where the next home goes.
 */

export function CardsManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [turned, setTurned] = useState<string | null>(opening.pick)
  const deck = useRef<HTMLUListElement>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  // The card drops as it's pressed; once it's out of sight it's forgotten, and the deck closes up.
  const forget = (home: LabHome) => {
    setTurned(null)
    setLeaving((was) => new Set(was).add(home.id))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      forgetting.forget(home, saved.indexOf(home))
      setLeaving((was) => {
        const next = new Set(was)
        next.delete(home.id)
        return next
      })
    }, 260)
    timers.current.add(timer)
  }
  return (
    <Dialog title="Homes" width={720} onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <ListMotion within={deck}>
        <ul className={s.deck} ref={deck}>
          {shown.map((home) => (
            <Keycard
              key={home.id}
              home={home}
              homes={homes}
              windowId={windowId}
              turned={turned === home.id}
              leaving={leaving.has(home.id)}
              onTurn={(on) => setTurned(on ? home.id : null)}
              onForget={() => forget(home)}
              onClose={onClose}
            />
          ))}
          <li data-move="add" className={s.slot}>
            <button type="button" className={s.blank} onClick={onConnect}>
              <span className={s.blankMark}>
                <Icon name="plus" size={18} />
              </span>
              <span>Connect a home</span>
            </button>
          </li>
        </ul>
      </ListMotion>
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

/** A card's initials: the first letters of its first two words, or a one-word name's first two. */
const initials = (name: string) => {
  const words = name.split(/[\s\-_.]+/).filter((word) => /^\p{L}/u.test(word))
  if (words.length >= 2) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
  const one = words[0] ?? name
  return `${one.slice(0, 1).toUpperCase()}${one.slice(1, 2)}`
}

/** The band's stripes, read off the home's id: their angle and spacing are the home's own. */
const band = (homeId: string): CSSProperties => {
  const digits = [...homeId.replace(/^home_/, '')].map((char) => Number.parseInt(char, 16) || 0)
  const angle = 15 + (digits[7] ?? 0) * 10
  const width = 4 + (digits[11] ?? 0) / 1.6
  return { '--ink': inkOf(homeId), '--angle': `${angle}deg`, '--stripe': `${width}px` } as CSSProperties
}

function Keycard({
  home,
  homes,
  windowId,
  turned,
  leaving,
  onTurn,
  onForget,
  onClose,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  turned: boolean
  leaving: boolean
  onTurn: (on: boolean) => void
  onForget: () => void
  onClose: () => void
}) {
  const status = useStatus(home, windowId)
  const live = useLiveness(home)
  const edit = useEdit(homes, home)
  const here = home.id === windowId
  const [lean, setLean] = useState({ x: 0, y: 0 })
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    if (still || turned) return
    const box = event.currentTarget.getBoundingClientRect()
    setLean({ x: ((event.clientX - box.left) / box.width - 0.5) * 2, y: ((event.clientY - box.top) / box.height - 0.5) * 2 })
  }
  return (
    <li data-move={home.id} className={s.slot}>
      <div
        className={s.lean}
        data-leaving={leaving || undefined}
        style={{ '--lx': turned ? 0 : lean.x, '--ly': turned ? 0 : lean.y } as CSSProperties}
        onPointerMove={follow}
        onPointerLeave={() => setLean({ x: 0, y: 0 })}
      >
        <div className={s.card} data-turned={turned || undefined} data-here={here || undefined} style={band(home.homeId)}>
          <div className={s.front} inert={turned}>
            <div className={s.band}>
              <span className={s.initials}>{initials(home.name)}</span>
              <LiveDot state={live} className={s.bandDot} />
            </div>
            <div className={s.facts}>
              <span className={s.name} title={home.name}>
                {home.name}
              </span>
              <Target home={home} />
              <span className={s.when} data-down={status.down || undefined}>
                {status.words}
              </span>
            </div>
            <div className={s.strip}>
              <Button size="small" variant="quiet" icon="pencil" onClick={() => onTurn(true)}>
                Edit
              </Button>
              {!here && (
                <Button size="small" onClick={() => openFrom(homes, home.id, onClose)}>
                  Open
                </Button>
              )}
            </div>
          </div>
          <div className={s.back} inert={!turned}>
            <div className={s.backBand} />
            <div className={s.backBody}>
              <NameField home={home} className={s.backName} />
              <ConnectionFields edit={edit} home={home} optionsOpen={false} />
              <div className={s.backId}>
                <span>Home</span>
                <Identity homeId={home.homeId} />
              </div>
            </div>
            <div className={s.strip}>
              <Button size="small" variant="quiet" icon="remove" className={s.forget} onClick={onForget}>
                Forget
              </Button>
              <Button size="small" onClick={() => onTurn(false)} disabled={edit.checking}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
