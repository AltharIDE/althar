// J · One search: the project has no button of its own. The bar's one gear (⌘,) opens every setting as a list you type into: on a project, its settings first, then the app's, each a line that changes in place or opens where it lives.
import { type ReactNode, useState } from 'react'

import { Dialog, Field, IconButton, LinkButton } from '../../../src/index'
import {
  AskingLine,
  Block,
  BranchesLine,
  calm as c,
  EndingLine,
  Line,
  LinkLine,
  NoteLines,
  notesCount,
  RemoveLink,
  RulesLine,
  RunLine,
  switchText,
  SwitchLine,
  WorktreesLine,
} from '../calm'
import { AddTrackerMenu, Identity, type Things, useThings } from '../parts'
import { proto, useProto } from '../state'
import type { QuickProps } from '../seams/QuickSettings'

import { SECTIONS, sectionText } from '../../../../../apps/desktop/src/renderer/features/settings/sections'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/text'

/** A setting, with the words it is found by. */
interface Entry {
  readonly key: string
  readonly words: string
  readonly line: ReactNode
}

function projectEntries(things: Things): ReadonlyArray<Entry> {
  const rules = things.rules
  return [
    ...(rules === null
      ? []
      : [
          {
            key: 'allow',
            words: `${switchText.allow} permissions ask`,
            line: <SwitchLine label={switchText.allow} checked={rules.allowEverything} onChange={things.setAllowEverything} />,
          },
          ...(things.trackers.length === 0
            ? []
            : [
                {
                  key: 'move',
                  words: `${switchText.move} tracker linear jira`,
                  line: <SwitchLine label={switchText.move} checked={rules.moveIssues} onChange={things.model.setMoveIssues} />,
                },
              ]),
          {
            key: 'conflicts',
            words: `${switchText.conflicts} merge`,
            line: <SwitchLine label={switchText.conflicts} checked={rules.resolveConflicts} onChange={things.model.setResolveConflicts} />,
          },
        ]),
    ...[things.host, ...things.trackers].flatMap((link) =>
      link === null
        ? []
        : [
            {
              key: link.id,
              words: `${link.name} ${link.what} ${link.login ?? ''} connection code issues tracker account`,
              line: <LinkLine link={link} things={things} />,
            },
          ],
    ),
    {
      key: 'add',
      words: 'add tracker linear jira github issues',
      line: (
        <Line
          label={things.trackers.length === 0 ? 'No tracker: tasks don’t start from issues' : 'Add a tracker'}
          off={things.trackers.length > 0}
          end={<AddTrackerMenu things={things} />}
        />
      ),
    },
    { key: 'asking', words: 'rules permissions ask coordinator', line: <AskingLine things={things} /> },
    { key: 'ending', words: 'finish pull request draft push end', line: <EndingLine things={things} /> },
    { key: 'branches', words: 'branches names pattern', line: <BranchesLine things={things} /> },
    { key: 'run', words: 'run commands dev script', line: <RunLine things={things} /> },
    { key: 'worktrees', words: 'worktrees folder disk', line: <WorktreesLine things={things} /> },
    { key: 'rules', words: 'rules commands accounts usage limits rotate', line: <RulesLine things={things} /> },
    {
      key: 'notes',
      words: 'notes coordinator decisions',
      line: (
        <Line
          label={`${notesCount(things)} notes the coordinator keeps`}
          end={<span>{things.model.notes?.at(-1)?.body.slice(0, 40)}…</span>}
        />
      ),
    },
    { key: 'name', words: `name rename colour color ink mark ${things.name}`, line: <Line label={`Name and colour: ${things.name}`} /> },
    { key: 'remove', words: 'remove delete project', line: <Line label="Remove from Althar" off end={<RemoveLink things={things} />} /> },
  ]
}

function Palette({ onClose, onSettings }: { onClose: () => void; onSettings: QuickProps['onSettings'] }) {
  const things = useThings()
  const p = useProto()
  const [query, setQuery] = useState(p.showing === 'notes' ? 'notes' : '')
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = (entry: { words: string }) => words.every((word) => entry.words.toLowerCase().includes(word))
  const project = projectEntries(things).filter(found)
  const app = SECTIONS.map((id) => ({ id, ...sectionText[id], words: `${sectionText[id].title} ${sectionText[id].lede}` })).filter(found)
  const named = project.find((one) => one.key === 'name') !== undefined && words.length > 0
  const notes = project.find((one) => one.key === 'notes') !== undefined && words.length > 0
  return (
    <Dialog title="Settings" onClose={onClose} width={620}>
      <div className={c.palette}>
        <Field
          size="large"
          placeholder={`Search ${things.name}’s settings and Althar’s`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={c.results}>
          {project.length > 0 && (
            <Block title={things.name} aside={things.troubles > 0 ? `${things.troubles} needs you` : undefined}>
              {project.map((one) => (
                <div key={one.key}>{one.line}</div>
              ))}
            </Block>
          )}
          {named && (
            <Block title="Name and colour">
              <div style={{ padding: 14 }}>
                <Identity things={things} />
              </div>
            </Block>
          )}
          {notes && (
            <Block title="Notes">
              <NoteLines things={things} />
            </Block>
          )}
          {app.length > 0 && (
            <Block title="Althar, for every project">
              {app.map((one) => (
                <Line
                  key={one.id}
                  label={one.title}
                  end={
                    <LinkButton
                      onClick={() => {
                        onClose()
                        onSettings(one.id)
                      }}
                    >
                      Open
                    </LinkButton>
                  }
                />
              ))}
            </Block>
          )}
          {project.length === 0 && app.length === 0 && <p className={c.empty}>No setting says “{query}”. Try telling the lead.</p>}
        </div>
      </div>
    </Dialog>
  )
}

/** The bar's gear, in J: the one way to every setting. */
export function JGear({ onSettings }: QuickProps) {
  const p = useProto()
  const open = p.showing !== 'closed'
  return (
    <>
      <IconButton
        icon="gear"
        label={text.gear}
        kbd={text.kbd}
        size="small"
        onClick={() => proto.set({ showing: open ? 'closed' : 'open' })}
      />
      {open && <Palette onClose={() => proto.set({ showing: 'closed' })} onSettings={onSettings} />}
    </>
  )
}
