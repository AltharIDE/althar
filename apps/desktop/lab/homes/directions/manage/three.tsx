import { useState } from 'react'
import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Glyph, Target, useHomes } from '../parts'
import { ConnectionFields, Forgotten, Identity, type ManageProps, NameField, openFrom, useEdit, useForget, useStatus } from './shared'
import s from './three.module.css'

/*
 * Manage 3 · Lines and a menu. One line a home, as the chip's menu has it:
 * pressing one opens it. The rest is in its ⋯ menu: Rename turns its name
 * into a field where it is; Edit connection turns the dialog to that home's
 * connection, with Back; Forget acts at once, with Undo.
 */

export function MenuManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(opening.pick)
  const edited = shown.find((home) => home.id === editing)
  if (edited !== undefined) return <EditConnection home={edited} homes={homes} onBack={() => setEditing(null)} onClose={onClose} />
  return (
    <Dialog
      title="Homes"
      width={500}
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
        <ul className={s.lines}>
          {shown.map((home) => (
            <Line
              key={home.id}
              home={home}
              homes={homes}
              windowId={windowId}
              renaming={renaming === home.id}
              onRename={() => setRenaming(home.id)}
              onRenamed={() => setRenaming(null)}
              onEdit={() => setEditing(home.id)}
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

function Line({
  home,
  homes,
  windowId,
  renaming,
  onRename,
  onRenamed,
  onEdit,
  onForget,
  onClose,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  renaming: boolean
  onRename: () => void
  onRenamed: () => void
  onEdit: () => void
  onForget: () => void
  onClose: () => void
}) {
  const status = useStatus(home, windowId)
  const here = home.id === windowId
  const words = (
    <>
      <Glyph kind={status.down ? 'down' : 'home'} size={16} className={s.glyph} />
      <span className={s.words}>
        {renaming ? (
          <NameField home={home} className={s.rename} autoFocus onDone={onRenamed} />
        ) : (
          <span className={s.name}>{home.name}</span>
        )}
        <Target home={home} />
      </span>
      <span className={s.when} data-down={status.down || undefined}>
        {status.words}
      </span>
    </>
  )
  return (
    <li className={s.line} data-here={here || undefined}>
      {renaming || here ? (
        <div className={s.lineOpen}>{words}</div>
      ) : (
        <button type="button" className={s.lineOpen} aria-label={`Open ${home.name}`} onClick={() => openFrom(homes, home.id, onClose)}>
          {words}
        </button>
      )}
      <Menu
        label={home.name}
        align="end"
        width={220}
        trigger={<IconButton icon="more" label={`${home.name}: more`} size="small" className={s.more} />}
      >
        <MenuItem icon="pencil" onSelect={onRename}>
          Rename
        </MenuItem>
        <MenuItem icon="plug" onSelect={onEdit}>
          Edit connection…
        </MenuItem>
        <MenuItem icon="copy" onSelect={() => void navigator.clipboard?.writeText(home.homeId).catch(() => undefined)}>
          Copy home ID
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="remove" tone="danger" quiet onSelect={onForget}>
          Forget
        </MenuItem>
      </Menu>
    </li>
  )
}

/** One home's connection, in the dialog's place, with Back to the list. */
function EditConnection({ home, homes, onBack, onClose }: { home: LabHome; homes: HomesHost; onBack: () => void; onClose: () => void }) {
  const edit = useEdit(homes, home)
  return (
    <Dialog
      title={home.name}
      width={500}
      onClose={onClose}
      onBack={onBack}
      holding={edit.checking}
      onSubmit={() => (edit.dirty ? edit.save() : onBack())}
      actions={
        <>
          <Button onClick={onBack}>{edit.dirty ? 'Cancel' : 'Done'}</Button>
          <Button type="submit" variant="signal" busy={edit.checking} disabled={!edit.dirty || edit.checking || edit.other !== null}>
            {edit.checking ? 'Checking…' : 'Check and save'}
          </Button>
        </>
      }
    >
      <div className={s.edit}>
        <ConnectionFields edit={edit} home={home} actions={false} />
        <div className={s.field}>
          <span>Home</span>
          <Identity homeId={home.homeId} />
        </div>
      </div>
    </Dialog>
  )
}
