import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, CopyButton, Dialog, IconButton, ListMotion } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Target, useHomes } from '../parts'
import s from './one.module.css'
import {
  ConnectionFields,
  type Editing,
  Forgotten,
  inked,
  LiveDot,
  type ManageProps,
  NameField,
  openFrom,
  Sigil,
  useEdit,
  useForget,
  useLiveness,
  useStatus,
} from './shared'

/*
 * Manage 1 · Sigils. Every home has a face: its identity, drawn. The homes
 * are tiles, each with its sigil and how it stands (green and breathing
 * while its window is connected). A tile opens to the home's passport: its
 * sigil large, the name changed in place, its connection. Checking a new
 * host draws what that host has: the same home's sigil lands on the saved
 * one; another home's stands beside it, plainly not the same. The sigil
 * travels between the two views, so the passport is the tile, grown.
 */

/** A step between the tiles and a passport, the sigil carried across where the browser can, at once where it can't or shouldn't. */
const step = (change: () => void) => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (still || document.startViewTransition === undefined) return change()
  document.startViewTransition(() => flushSync(change))
}

export function SigilManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [picked, setPicked] = useState<string | null>(opening.pick)
  const home = shown.find((one) => one.id === picked)
  const grid = useRef<HTMLUListElement>(null)
  const back = () => step(() => setPicked(null))
  if (home !== undefined)
    return (
      <Passport
        home={home}
        homes={homes}
        windowId={windowId}
        onBack={back}
        onClose={onClose}
        onForget={() => {
          step(() => setPicked(null))
          forgetting.forget(home, saved.indexOf(home))
        }}
      />
    )
  return (
    <Dialog title="Homes" width={600} onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <ListMotion within={grid} enter="grow">
        <ul className={s.tiles} ref={grid}>
          {shown.map((one) => (
            <Tile
              key={one.id}
              home={one}
              homes={homes}
              windowId={windowId}
              onPick={() => step(() => setPicked(one.id))}
              onClose={onClose}
            />
          ))}
          <li data-move="add">
            <button type="button" className={`${s.tile} ${s.add}`} onClick={onConnect}>
              <Sigil homeId={null} size={44} />
              <span className={s.name}>Connect a home</span>
              <span className={s.when}>Over SSH</span>
            </button>
          </li>
        </ul>
      </ListMotion>
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

function Tile({
  home,
  homes,
  windowId,
  onPick,
  onClose,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  onPick: () => void
  onClose: () => void
}) {
  const status = useStatus(home, windowId)
  const live = useLiveness(home)
  const here = home.id === windowId
  return (
    <li data-move={home.id} className={s.cell}>
      <button type="button" className={s.tile} data-here={here || undefined} style={inked(home.homeId)} onClick={onPick}>
        <Sigil homeId={home.homeId} size={44} className={s.face} {...vt(`sigil-${home.id}`)} />
        <span className={s.name} {...vt(`name-${home.id}`)}>
          {home.name}
        </span>
        <Target home={home} />
        <span className={s.when} data-down={status.down || undefined}>
          <LiveDot state={live} />
          {status.words}
        </span>
      </button>
      {!here && (
        <IconButton
          icon="external"
          label={`Open ${home.name}`}
          size="small"
          className={s.open}
          onClick={() => openFrom(homes, home.id, onClose)}
        />
      )}
    </li>
  )
}

/** Names what the browser carries between the views. */
const vt = (name: string) => ({ style: { viewTransitionName: name } })

function Passport({
  home,
  homes,
  windowId,
  onBack,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  onBack: () => void
  onClose: () => void
  onForget: () => void
}) {
  const edit = useEdit(homes, home)
  const status = useStatus(home, windowId)
  const live = useLiveness(home)
  const here = home.id === windowId
  return (
    <Dialog
      title="Homes"
      width={600}
      onClose={onClose}
      onBack={onBack}
      holding={edit.checking}
      actions={
        <>
          {!here && <Button onClick={() => openFrom(homes, home.id, onClose)}>Open</Button>}
          <Button onClick={onBack}>Done</Button>
        </>
      }
    >
      <div className={s.passport} style={inked(home.homeId)}>
        <header className={s.head}>
          <Sigil homeId={home.homeId} size={88} className={s.big} {...vt(`sigil-${home.id}`)} />
          <div className={s.headWords}>
            <span {...vt(`name-${home.id}`)} className={s.nameWrap}>
              <NameField key={home.id} home={home} className={s.bigName} />
            </span>
            <Target home={home} />
            <span className={s.when} data-down={status.down || undefined}>
              <LiveDot state={live} />
              {status.words}
            </span>
          </div>
        </header>
        <section className={s.section}>
          <h3 className={s.label}>Connection</h3>
          <ConnectionFields edit={edit} home={home} results={false} />
        </section>
        <section className={s.section}>
          <h3 className={s.label}>Identity</h3>
          <Likeness edit={edit} home={home} />
        </section>
        <footer className={s.forget}>
          <Button size="small" variant="danger" icon="remove" onClick={onForget}>
            Forget {home.name}
          </Button>
        </footer>
      </div>
    </Dialog>
  )
}

/**
 * The home's identity beside what the host just checked has: nothing yet; a
 * blank face while it's asked; the same sigil landing on the saved one; or
 * another one, plainly not the same, which can be saved as a home of its own.
 */
function Likeness({ edit, home }: { edit: Editing; home: LabHome }) {
  const found = edit.other?.homeId ?? (edit.kept && !edit.dirty ? home.homeId : null)
  const state = edit.checking ? 'asking' : edit.other !== null ? 'other' : found !== null ? 'same' : 'saved'
  return (
    <div className={s.likeness} data-state={state}>
      <div className={s.pair}>
        <Sigil homeId={home.homeId} size={48} />
        {state === 'asking' && <Sigil homeId={null} size={48} className={s.asking} />}
        {state === 'other' && (
          <>
            <span className={s.not} aria-hidden="true">
              ≠
            </span>
            <Sigil homeId={found} size={48} className={s.arrive} />
          </>
        )}
        {state === 'same' && <Sigil homeId={home.homeId} size={48} className={s.land} />}
      </div>
      <div className={s.likeWords}>
        {state === 'other' ? (
          <>
            <span className={s.verdict} data-tone="other">
              {edit.form.target.trim()} has another home
            </span>
            <span className={s.sub}>
              {home.name} stays on {home.ssh.target}.
            </span>
          </>
        ) : state === 'same' ? (
          <span className={s.verdict} data-tone="same" role="status">
            Same home, now on {home.ssh.target}
          </span>
        ) : (
          <span className={s.id}>
            <code>{home.homeId}</code>
            <CopyButton value={home.homeId} />
          </span>
        )}
      </div>
      {state === 'other' && (
        <Button size="small" onClick={edit.saveNew}>
          Save as a new home
        </Button>
      )}
    </div>
  )
}
