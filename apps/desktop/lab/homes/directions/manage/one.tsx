import { useRef, useState } from 'react'
import { Button, Dialog, Icon, ListMotion } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Glyph, useHomes } from '../parts'
import s from './one.module.css'
import {
  ConnectionFields,
  Forgotten,
  HomeDot,
  Identity,
  type Liveness,
  type ManageProps,
  NameField,
  openFrom,
  Projects,
  shortId,
  useEdit,
  useForget,
  useLiveness,
  useQuietFocus,
  useStatus,
} from './shared'

/*
 * Manage 1 · Drawing. The homes drawn the way Althar's own drawings draw
 * things: cards on dotted paper, tied by a thin line. This computer heads
 * it; each home hangs off it, its tie drawn as its connection stands (cobalt
 * while a window is connected, a broken red where it dropped, a hairline at
 * rest). A card is a home's facts, in the drawings' order: where it is and
 * its short identity, its name, the projects on it and how it stands.
 * Pressing a card opens it in place to its connection, its identity and
 * Forget; its name, the card's title, is changed where it stands.
 */

export function DrawingManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [picked, setPicked] = useState<string | null>(opening.pick)
  const list = useRef<HTMLUListElement>(null)
  useQuietFocus(list)
  return (
    <Dialog title="Homes" width={620} tall onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <div className={s.paper}>
        <article className={`${s.card} ${s.me}`}>
          <span className={s.eyebrow}>
            <Glyph kind="local" size={13} />
            <span className={s.where}>Local</span>
          </span>
          <span className={s.title}>This computer</span>
          <span className={s.facts}>
            <Projects on="local" live />
            {windowId === 'local' && (
              <span className={s.status}>
                <HomeDot state="live" />
                This window
              </span>
            )}
          </span>
        </article>
        <ListMotion within={list} enter="grow">
          <ul className={s.tree} ref={list}>
            {shown.map((home) => (
              <Branch
                key={home.id}
                home={home}
                homes={homes}
                windowId={windowId}
                open={picked === home.id}
                onToggle={() => setPicked((was) => (was === home.id ? null : home.id))}
                onClose={onClose}
                onForget={() => {
                  setPicked(null)
                  forgetting.forget(home, saved.indexOf(home))
                }}
              />
            ))}
            <li data-move="add" className={s.branch} data-tie="add">
              <button type="button" className={`${s.card} ${s.add}`} onClick={onConnect}>
                <Icon name="plus" size={14} />
                Connect a home
              </button>
            </li>
          </ul>
        </ListMotion>
      </div>
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

function Branch({
  home,
  homes,
  windowId,
  open,
  onToggle,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onForget: () => void
}) {
  const live: Liveness = useLiveness(home)
  const status = useStatus(home, windowId)
  const here = home.id === windowId
  const eyebrow = (
    <>
      <Glyph kind={live === 'down' ? 'down' : 'home'} size={13} />
      <span className={s.where}>{home.ssh.target}</span>
      <span className={s.key}>{shortId(home.homeId)}</span>
    </>
  )
  const facts = (
    <span className={s.facts}>
      <Projects on={home.id} live={live === 'live'} />
      <span className={s.status} data-down={status.down || undefined}>
        <HomeDot state={live} />
        {status.words}
      </span>
    </span>
  )
  return (
    <li data-move={home.id} className={s.branch} data-tie={live}>
      {open ? (
        <article className={s.card} data-open data-live={live === 'live' || undefined}>
          <button type="button" className={s.eyebrow} aria-expanded="true" aria-label={`${home.name}, close`} onClick={onToggle}>
            {eyebrow}
            <Icon name="chevronU" size={13} className={s.caret} />
          </button>
          <NameField key={home.id} home={home} className={s.titleField} />
          {facts}
          <Details home={home} homes={homes} here={here} onClose={onClose} onForget={onForget} />
        </article>
      ) : (
        <button type="button" className={s.card} data-live={live === 'live' || undefined} aria-expanded="false" onClick={onToggle}>
          <span className={s.eyebrow}>{eyebrow}</span>
          <span className={s.title}>{home.name}</span>
          {facts}
        </button>
      )}
    </li>
  )
}

/** An open card's rest: its connection, checked before it's kept; its identity; and Forget, set apart at its foot. */
function Details({
  home,
  homes,
  here,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  here: boolean
  onClose: () => void
  onForget: () => void
}) {
  const edit = useEdit(homes, home)
  return (
    <div className={s.details}>
      <section className={s.row}>
        <h3 className={s.label}>SSH host</h3>
        <ConnectionFields edit={edit} home={home} label={false} />
      </section>
      <section className={s.row}>
        <h3 className={s.label}>Identity</h3>
        <Identity homeId={home.homeId} />
      </section>
      <footer className={s.foot}>
        <Button size="small" variant="danger" icon="remove" onClick={onForget}>
          Forget
        </Button>
        {!here && (
          <Button size="small" onClick={() => openFrom(homes, home.id, onClose)}>
            Open
          </Button>
        )}
      </footer>
    </div>
  )
}
