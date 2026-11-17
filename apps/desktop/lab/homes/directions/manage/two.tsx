import { useState } from 'react'
import { Button, Code, Dialog, Icon } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import { type LabHome, isSaved } from '../../world'
import { Glyph, homeProblem, isOpen, Refusal, Target, useHomes, Working } from '../parts'
import { ConnectionFields, Forgotten, Identity, type ManageProps, NameField, openFrom, useEdit, useForget, useStatus } from './shared'
import s from './two.module.css'

/*
 * Manage 2 · List and details. The homes down the left, as Settings lists
 * its sections; the one picked on the right, whole: its name (the title,
 * changed in place), its connection, its identity with a check that asks the
 * host now, and Forget at the foot, in the danger colour. Starts on the
 * window's own home, where it is one.
 */

export function PanesManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [pick, setPick] = useState<string | null>(opening.pick ?? (isSaved(windowId) ? windowId : null))
  const home = shown.find((one) => one.id === pick) ?? shown[0]
  return (
    <Dialog title="Homes" width={760} tall onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <div className={s.panes}>
        <nav className={s.side} aria-label="Saved homes">
          <ul className={s.list}>
            {shown.map((one) => (
              <Item key={one.id} home={one} windowId={windowId} picked={one.id === home?.id} onPick={() => setPick(one.id)} />
            ))}
          </ul>
          <Button icon="plus" size="small" variant="quiet" className={s.add} onClick={onConnect}>
            Connect a home…
          </Button>
          <Forgotten forgetting={forgetting} className={s.undo} />
        </nav>
        {home === undefined ? (
          <div className={s.none}>No saved homes.</div>
        ) : (
          <Details
            key={home.id}
            home={home}
            homes={homes}
            windowId={windowId}
            onForget={() => forgetting.forget(home, saved.indexOf(home))}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  )
}

function Item({ home, windowId, picked, onPick }: { home: LabHome; windowId: string; picked: boolean; onPick: () => void }) {
  const status = useStatus(home, windowId)
  return (
    <li>
      <button type="button" className={s.item} aria-current={picked || undefined} onClick={onPick}>
        <Glyph kind={status.down ? 'down' : 'home'} size={14} className={s.itemGlyph} />
        <span className={s.itemName}>{home.name}</span>
        {isOpen(home.id) && <span className={s.dot} data-down={status.down || undefined} aria-label={status.words} />}
      </button>
    </li>
  )
}

/** Asking the host now whether it still has this home. */
const useVerify = (homes: HomesHost, home: LabHome) => {
  const [now, setNow] = useState<{ phase: 'idle' | 'checking' | 'same' | 'other' | 'refused'; words?: string }>({ phase: 'idle' })
  const check = () => {
    setNow({ phase: 'checking' })
    void homes
      .inspect(home.ssh)
      .then((found) =>
        setNow(
          found.homeId === home.homeId
            ? { phase: 'same', words: `Same home, althar-host ${found.version}` }
            : { phase: 'other', words: `${home.ssh.target} has a different home now: ${found.homeId}. Connecting to it will refuse.` },
        ),
      )
      .catch((error: unknown) => {
        const said = homeProblem(error)
        if (said !== 'The home check was cancelled.') setNow({ phase: 'refused', words: said })
      })
  }
  return { now, check }
}

function Details({
  home,
  homes,
  windowId,
  onForget,
  onClose,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  onForget: () => void
  onClose: () => void
}) {
  const status = useStatus(home, windowId)
  const edit = useEdit(homes, home)
  const verify = useVerify(homes, home)
  const here = home.id === windowId
  return (
    <section className={s.details} aria-label={home.name}>
      <header className={s.header}>
        <span className={s.heading}>
          <NameField home={home} className={s.title} />
          <span className={s.status} data-down={status.down || undefined}>
            <Target home={home} className={s.host} />
            <span aria-hidden="true">·</span>
            {status.words}
          </span>
        </span>
        {!here && (
          <Button size="small" variant="signal" onClick={() => openFrom(homes, home.id, onClose)}>
            {isOpen(home.id) ? 'Show window' : 'Open'}
          </Button>
        )}
      </header>
      <section className={s.section}>
        <h3 className={s.label}>Connection</h3>
        <ConnectionFields edit={edit} home={home} />
      </section>
      <section className={s.section}>
        <h3 className={s.label}>Identity</h3>
        <Identity homeId={home.homeId} />
        <p className={s.note}>
          On the host, <Code>althar-host status</Code> prints this home.
        </p>
        <span className={s.verify}>
          <Button size="small" busy={verify.now.phase === 'checking'} disabled={verify.now.phase === 'checking'} onClick={verify.check}>
            Check now
          </Button>
          {verify.now.phase === 'checking' && <Working>{`Asking ${home.ssh.target}…`}</Working>}
          {verify.now.phase === 'same' && (
            <span className={s.same} role="status">
              <Icon name="check" size={13} />
              {verify.now.words}
            </span>
          )}
        </span>
        {(verify.now.phase === 'refused' || verify.now.phase === 'other') && <Refusal problem={verify.now.words ?? ''} />}
      </section>
      <section className={s.danger}>
        <Button size="small" variant="danger" onClick={onForget}>
          Forget {home.name}
        </Button>
      </section>
    </section>
  )
}
