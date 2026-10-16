// A · A calm panel: the quick panel kept, as groups of the app's own setting rows under plain headers, every switch at the row's end, nothing moving with what the project has.
import { type ReactNode, useState } from 'react'

import { Button, ControlCenter, ControlDetail, ControlFoot, ControlSheet, LinkButton } from '../../../src/index'
import {
  AllowEverything,
  Conflicts,
  Identity,
  IdentityRow,
  LinkRow,
  MoveIssues,
  Notes,
  NotesRow,
  overlay,
  RulesRow,
  RunsRow,
  SettingList,
  type Things,
} from '../parts'
import css from '../parts.module.css'
import { useProto } from '../state'

/** A group: its header, then its rows on a sheet. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>{title}</h3>
      <ControlSheet>
        <SettingList>{children}</SettingList>
      </ControlSheet>
    </section>
  )
}

export function A({ things }: { things: Things }) {
  const p = useProto()
  const [open, setOpen] = useState(p.showing !== 'closed')
  // Opened as the picker says: the page keys it by that, so it starts again when it changes.
  const [showing, setShowing] = useState<'all' | 'identity' | 'notes'>(p.showing === 'notes' ? 'notes' : 'all')
  return (
    <ControlCenter
      trigger={
        <Button size="small" variant="quiet" icon="gear">
          Settings
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setShowing('all')
      }}
      onEscapeKeyDown={(event) => {
        if (showing === 'all') return
        event.preventDefault()
        setShowing('all')
      }}
      width={460}
      text={{ label: `${things.name}’s settings` }}
    >
      {showing === 'all' ? (
        <>
          <div className={`${css.panel} ${css.tall}`}>
            <SettingList className={css.head}>
              <IdentityRow things={things} onChange={() => setShowing('identity')} />
            </SettingList>
            <Group title="For every task">
              <MoveIssues things={things} />
              <Conflicts things={things} />
              <AllowEverything things={things} />
            </Group>
            <Group title="Code and issues">
              {things.host !== null && <LinkRow link={things.host} things={things} />}
              {things.tracker !== null && <LinkRow link={things.tracker} things={things} />}
            </Group>
            <Group title="Rules, runs and notes">
              <RulesRow things={things} />
              <RunsRow things={things} />
              <NotesRow things={things} onOpen={() => setShowing('notes')} />
            </Group>
          </div>
          <ControlFoot>
            <span className={css.quiet}>Worktrees in {things.worktrees}</span>
            <LinkButton onClick={() => overlay.set({ removing: true })}>Remove from Althar…</LinkButton>
          </ControlFoot>
        </>
      ) : showing === 'notes' ? (
        <ControlDetail title="Notes" aside={`${things.model.notes?.length ?? 0}`} onBack={() => setShowing('all')}>
          <ControlSheet>
            <Notes things={things} />
          </ControlSheet>
        </ControlDetail>
      ) : (
        <ControlDetail title="Name and colour" onBack={() => setShowing('all')}>
          <ControlSheet>
            <Identity things={things} />
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}
