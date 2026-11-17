import { useId, useState } from 'react'
import { Button, Caret, Dialog } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Glyph, isOpen, Target, useHomes } from '../parts'
import { ConnectionFields, Forgotten, Identity, type ManageProps, NameField, openFrom, useEdit, useForget, useStatus } from './shared'
import s from './one.module.css'

/*
 * Manage 1 · Rows that open. The homes as the chip's menu lists them, one
 * row each; a row opens in place to everything about its home: its name, its
 * connection, its identity, and Forget, set apart at its foot. One open at a
 * time; Open sits on each row's end as it's hovered.
 */

export function RowsManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [open, setOpen] = useState<string | null>(opening.pick)
  return (
    <Dialog
      title="Homes"
      width={540}
      onClose={onClose}
      actions={
        <>
          <Button icon="plus" onClick={onConnect}>
            Connect a home…
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {shown.length === 0 ? (
        <p className={s.none}>No saved homes.</p>
      ) : (
        <ul className={s.rows}>
          {shown.map((home) => (
            <Row
              key={home.id}
              home={home}
              homes={homes}
              windowId={windowId}
              open={open === home.id}
              onToggle={() => setOpen(open === home.id ? null : home.id)}
              onForget={() => forgetting.forget(home, saved.indexOf(home))}
              onClose={onClose}
            />
          ))}
        </ul>
      )}
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

function Row({
  home,
  homes,
  windowId,
  open,
  onToggle,
  onForget,
  onClose,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  open: boolean
  onToggle: () => void
  onForget: () => void
  onClose: () => void
}) {
  const id = useId()
  const status = useStatus(home, windowId)
  const here = home.id === windowId
  return (
    <li className={s.row} data-open={open || undefined}>
      <div className={s.head}>
        <button type="button" className={s.toggle} aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          <Glyph kind={status.down ? 'down' : 'home'} size={16} className={s.glyph} />
          <span className={s.words}>
            <span className={s.name}>{home.name}</span>
            <Target home={home} />
          </span>
          <span className={s.when} data-down={status.down || undefined}>
            {status.words}
          </span>
          <Caret open={open} className={s.caret} />
        </button>
        {!here && (
          <Button size="small" className={s.open} onClick={() => openFrom(homes, home.id, onClose)}>
            {isOpen(home.id) ? 'Show' : 'Open'}
          </Button>
        )}
      </div>
      {open && <Body id={`${id}-body`} home={home} homes={homes} onForget={onForget} />}
    </li>
  )
}

function Body({ id, home, homes, onForget }: { id: string; home: LabHome; homes: HomesHost; onForget: () => void }) {
  const field = useId()
  const edit = useEdit(homes, home)
  return (
    <div id={id} className={s.body}>
      <label className={s.field} htmlFor={`${field}-name`}>
        <span>Name</span>
        <NameField home={home} id={`${field}-name`} />
      </label>
      <ConnectionFields edit={edit} home={home} />
      <div className={s.field}>
        <span>Home</span>
        <Identity homeId={home.homeId} />
      </div>
      <div className={s.foot}>
        <Button size="small" variant="danger" onClick={onForget}>
          Forget
        </Button>
      </div>
    </div>
  )
}
