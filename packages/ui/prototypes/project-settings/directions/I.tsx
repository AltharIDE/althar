// I · The header unfolds: Project settings opens the front page itself downward, over the top of the board, in three columns: the project, its code and issues, how its tasks run. Nothing new to learn: it is the header, taller.
import { useState } from 'react'

import { Button } from '../../../src/index'
import { Block, calm as c, useEscape, CodeAndIssues, Line, NoteLines, notesCount, RemoveLink, Shared, Switches, TaskLines } from '../calm'
import { Identity, type Things } from '../parts'
import { proto, useProto } from '../state'

/** Its button at the front page's end: pressed, the header is open. */
export function IButton() {
  const p = useProto()
  const open = p.showing !== 'closed'
  return (
    <Button size="small" variant={open ? 'default' : 'quiet'} onClick={() => proto.set({ showing: open ? 'closed' : 'open' })}>
      {open ? 'Close settings' : 'Project settings'}
    </Button>
  )
}

export function I({ things }: { things: Things }) {
  const p = useProto()
  const [naming, setNaming] = useState(false)
  useEscape(() => proto.set({ showing: 'closed' }))
  return (
    <div className={c.unfold}>
      <div className={c.unfoldCols}>
        <div className={c.tabs}>
          {naming && (
            <Block title="Name and colour">
              <div style={{ padding: 14 }}>
                <Identity things={things} />
              </div>
            </Block>
          )}
          <Block title="Every task">
            <Switches things={things} />
          </Block>
        </div>
        <div className={c.tabs}>
          <Block title="Code and issues">
            <CodeAndIssues things={things} />
          </Block>
          <Shared things={things} />
        </div>
        <div className={c.tabs}>
          <Block title="How tasks run">
            <TaskLines things={things} rules={false} />
          </Block>
        </div>
      </div>
      {p.showing === 'notes' ? (
        <Block title={`Notes the coordinator keeps · ${notesCount(things)}`}>
          <NoteLines things={things} most={4} />
        </Block>
      ) : (
        <Block>
          <Line
            label={`${notesCount(things)} notes · ${things.model.notes?.at(-1)?.body ?? ''}`}
            off
            end={
              <Button size="small" variant="quiet" onClick={() => proto.set({ showing: 'notes' })}>
                Read notes
              </Button>
            }
          />
        </Block>
      )}
      <div className={c.foot}>
        <span>
          <Button size="small" variant="quiet" onClick={() => setNaming(!naming)}>
            {naming ? 'Done naming' : 'Name and colour'}
          </Button>
          <Button size="small" variant="quiet" onClick={things.openRules}>
            Commands, accounts and usage limits
          </Button>
        </span>
        <RemoveLink things={things} />
      </div>
    </div>
  )
}
