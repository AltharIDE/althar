// Scrappy: the project's settings by section, as every direction shows them: what each is called and says, and what is in it, from the app's own screens and rows.
import type { ReactNode } from 'react'

import {
  Button,
  ControlGrid,
  ControlToggle,
  Heading,
  Icon,
  IconButton,
  type IconName,
  LinkButton,
  SettingList,
  SettingSwitch,
} from '../../src/index'
import {
  AddTrackerMenu,
  AppWide,
  Identity,
  MoveIssues,
  overlay,
  RemoveRow,
  RunRows,
  type Things,
  TrackerRows,
  WhereRows,
  words,
} from './parts'
import { PROJECT } from './parts'
import css from './sections.module.css'
import { proto, type Section } from './state'

import { useConnections } from '../../../../apps/desktop/src/renderer/features/connections/useConnections'
import { RepositoriesView } from '../../../../apps/desktop/src/renderer/features/repositories/RepositoriesView'
import { type RepositoriesModel, useRepositories } from '../../../../apps/desktop/src/renderer/features/repositories/useRepositories'
import { RulesView } from '../../../../apps/desktop/src/renderer/features/rules/RulesView'
import { useRules } from '../../../../apps/desktop/src/renderer/features/rules/useRules'

/* ——— What each section is called, and says it is for. ——— */

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly lede: string; readonly icon: IconName }>> = {
  general: {
    title: 'General',
    lede: 'Its name and colour, the switches every task follows, and taking it out of Althar.',
    icon: 'gear',
  },
  code: {
    title: 'Code and issues',
    lede: 'Its repositories and where their work goes, and the trackers its tasks come from.',
    icon: 'plug',
  },
  rules: { title: 'Rules', lede: 'What agents may do without asking, what waits for you, and how a task ends.', icon: 'lock' },
  running: { title: 'Running', lede: 'What it runs with no agent, and where its tasks’ worktrees and branches go.', icon: 'play' },
  notes: { title: 'Notes', lede: 'What the coordinator keeps from your conversations, that the code doesn’t show.', icon: 'quote' },
}

/** Leaving Settings, for the screens that go back on Escape. */
const leave = () => proto.set({ showing: 'closed' })

/* ——— The pieces. ——— */

/** A heading inside a section, small, as the app's Settings put Code hosts and Trackers. */
export function Sub({ title, note, end }: { title: string; note?: string; end?: ReactNode }) {
  return (
    <div className={css.sub}>
      <div>
        <Heading level={3} className={css.subTitle}>
          {title}
        </Heading>
        {note !== undefined && <p className={css.subNote}>{note}</p>}
      </div>
      {end}
    </div>
  )
}

/**
 * One of the app's own screens, inside a section: the rules, the repositories.
 * Bare, its back crumb and its own heading go, as the section names it.
 */
function Embed({ bare, children }: { bare: boolean; children: ReactNode }) {
  return <div className={bare ? `${css.embed} ${css.bare}` : css.embed}>{children}</div>
}

export function RulesScreen({ bare = true }: { bare?: boolean }) {
  return (
    <Embed bare={bare}>
      <RulesView model={useRules(PROJECT)} onBack={leave} />
    </Embed>
  )
}

export function RepositoriesScreen({ bare = true, model }: { bare?: boolean; model?: RepositoriesModel }) {
  const own = useRepositories(PROJECT)
  return (
    <Embed bare={bare}>
      <RepositoriesView model={model ?? own} connections={useConnections()} onBack={leave} />
    </Embed>
  )
}

/* ——— The quick switches, as the app's Settings show its own at the top of its side. ——— */

const quickText = {
  allow: { title: 'Allow everything', on: 'Nothing waits for you', off: 'The rules say what asks' },
  move: { title: 'Move issues', on: 'As their tasks start', off: 'You move them' },
  conflicts: { title: 'Resolve conflicts', on: 'The lead fixes them', off: 'You ask the lead' },
}

/** The switches a project changes most, as cards: the circle turns one on or off; its name opens its section. */
export function QuickCards({ things, columns = 2, onSection }: { things: Things; columns?: 1 | 2; onSection: (section: Section) => void }) {
  const rules = things.rules
  if (rules === null) return null
  const cards = [
    {
      words: quickText.allow,
      on: rules.allowEverything,
      set: things.setAllowEverything,
      glyph: 'lock' as const,
      section: 'rules' as const,
    },
    {
      words: quickText.conflicts,
      on: rules.resolveConflicts,
      set: things.model.setResolveConflicts,
      glyph: 'branch' as const,
      section: 'general' as const,
    },
    ...(things.trackers.length === 0
      ? []
      : [
          {
            words: quickText.move,
            on: rules.moveIssues,
            set: things.model.setMoveIssues,
            glyph: 'play' as const,
            section: 'code' as const,
          },
        ]),
  ]
  return (
    <ControlGrid row={28} columns={columns === 1 ? 2 : 4}>
      {cards.map((card, i) => {
        const row = columns === 1 ? 1 + i * 2 : 1 + Math.floor(i / 2) * 2
        return (
          <ControlToggle
            key={card.words.title}
            title={card.words.title}
            line={card.on ? card.words.on : card.words.off}
            on={card.on}
            onChange={card.set}
            glyph={<Icon name={card.glyph} size={16} />}
            onOpen={() => onSection(card.section)}
            place={{ column: columns === 1 || i % 2 === 0 ? [1, 3] : [3, 5], row: [row, row + 2] }}
          />
        )
      })}
    </ControlGrid>
  )
}

/* ——— What is in each section. ——— */

/**
 * How its tasks work: the three switches, each said in full, what happens
 * with it on and with it off, for someone who has never seen them: no
 * shortcut names it before this does.
 */
export function TaskSwitches({ things }: { things: Things }) {
  const rules = things.rules
  if (rules === null) return null
  const tracker = things.trackers[0]
  const trackerWord = things.trackers.length === 1 && tracker !== undefined ? tracker.name : 'its tracker'
  return (
    <div>
      <Sub
        title="How its tasks work"
        note={`For every task in ${things.name}, from its next step on. A task can still be told otherwise in its conversation.`}
      />
      <SettingList>
        <SettingSwitch
          title="Allow everything"
          note={
            <>
              Agents run any command and change any file without stopping to ask you. Only what the rules never allow stays blocked.
              <span className={css.offLine}>
                <b className={css.off}>Off:</b> the <LinkButton onClick={() => proto.set({ section: 'rules' })}>rules</LinkButton> decide
                what goes ahead and what waits for your answer.
              </span>
            </>
          }
          checked={rules.allowEverything}
          onChange={things.setAllowEverything}
        />
        <SettingSwitch
          title="Resolve merge conflicts automatically"
          note={
            <>
              When main moves on and a task’s change no longer merges cleanly, the lead brings main into its branch, fixes the clashing
              lines and runs the checks again, then tells you what it did.
              <span className={css.offLine}>
                <b className={css.off}>Off:</b> the task stops and says it conflicts; you ask the lead to fix it when you want.
              </span>
            </>
          }
          checked={rules.resolveConflicts}
          onChange={things.model.setResolveConflicts}
        />
        <SettingSwitch
          title="Move issues to In Progress"
          note={
            things.trackers.length === 0 ? (
              <>
                When a task starts from an issue, its tracker shows it’s being worked on.{' '}
                <LinkButton onClick={() => proto.set({ section: 'code' })}>Add a tracker</LinkButton> first.
              </>
            ) : (
              <>
                When a task starts from a {trackerWord} issue, Althar moves that issue to In Progress, so whoever looks at {trackerWord}{' '}
                sees it’s being worked on.
                <span className={css.offLine}>
                  <b className={css.off}>Off:</b> issues stay where they are, and you move them yourself.
                </span>
              </>
            )
          }
          checked={things.trackers.length > 0 && rules.moveIssues}
          disabled={things.trackers.length === 0}
          onChange={things.model.setMoveIssues}
        />
      </SettingList>
    </div>
  )
}

/** Where the page has the quick cards, its switches are there, not here again; where its side has Remove, so is that. */
export function General({ things, switches = true, remove = true }: { things: Things; switches?: boolean; remove?: boolean }) {
  return (
    <div className={css.stack}>
      <Identity things={things} />
      {switches && <TaskSwitches things={things} />}
      {remove && (
        <div className={css.away}>
          <SettingList>
            <RemoveRow things={things} />
          </SettingList>
        </div>
      )}
    </div>
  )
}

/**
 * Its repositories, under a heading of its own with the way to add one, then
 * its trackers the same way: two headings in the section's one style, the
 * repositories screen's own big title and drop line left out.
 */
export function CodeAndIssues({ things, bare = true, moveIssues = true }: { things: Things; bare?: boolean; moveIssues?: boolean }) {
  const repositories = useRepositories(PROJECT)
  const anyTracker = things.trackers.length > 0
  return (
    <div className={css.stack}>
      <div>
        <Sub
          title="Repositories"
          note="Its folders on this Mac, and where each one’s work goes."
          end={
            bare ? (
              <Button size="small" onClick={() => void repositories.add()}>
                <Icon name="plus" size={13} /> Add a folder
              </Button>
            ) : undefined
          }
        />
        <RepositoriesScreen bare={bare} model={repositories} />
      </div>
      <div className={css.trackers}>
        <Sub
          title="Trackers"
          note="Where its issues are. Tasks start from them, and move them as they go."
          end={
            anyTracker ? (
              <AddTrackerMenu
                things={things}
                trigger={
                  <Button size="small">
                    <Icon name="plus" size={13} /> Add a tracker
                  </Button>
                }
              />
            ) : undefined
          }
        />
        <SettingList>
          <TrackerRows things={things} quietAdd>
            {moveIssues && <MoveIssues things={things} indent />}
          </TrackerRows>
        </SettingList>
      </div>
      <AppWide things={things} />
    </div>
  )
}

export function Running({ things }: { things: Things }) {
  return (
    <div className={css.stack}>
      <div>
        <Sub
          title="What it runs"
          note="With no agent, from Run on its front page. The first is what Run starts."
          end={
            <Button size="small" onClick={() => overlay.set({ runs: true })}>
              Edit list
            </Button>
          }
        />
        <SettingList>
          <RunRows things={things} />
        </SettingList>
      </div>
      <div>
        <Sub title="Where its work goes" note="On this Mac, and on the code host." />
        <SettingList>
          <WhereRows things={things} />
        </SettingList>
      </div>
    </div>
  )
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/**
 * The notes, each a card of its own: what was decided, set as words to read
 * rather than a field to type in, and under it who kept it and when. Newest
 * first; the way to drop one shows on the card it is over.
 */
export function NotesSection({ things }: { things: Things }) {
  const notes = [...(things.model.notes ?? [])].reverse()
  if (notes.length === 0)
    return (
      <div className={css.noNotes}>
        <Icon name="quote" size={18} />
        <p>No notes yet. When you decide something in a conversation that the code doesn’t show, the coordinator keeps it here.</p>
      </div>
    )
  return (
    <div>
      <Sub
        title={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        note="The coordinator starts each session with them. To change one, tell the lead."
      />
      <ul className={css.notes}>
        {notes.map((note) => (
          <li key={note.id} className={css.note}>
            <Icon name="quote" size={14} className={css.noteMark} />
            <p className={css.noteBody}>{note.body}</p>
            <p className={css.noteFoot}>
              {note.keptBy === 'person' ? 'Kept by you' : 'Kept by the coordinator'} · {day.format(new Date(note.createdAt))}
            </p>
            <span className={css.noteDrop}>
              <IconButton icon="close" label="Drop this note" size="small" onClick={() => void things.model.dropNote(note.id)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A section's body, whichever it is. */
export function Body({
  section,
  things,
  bare = true,
  switches = true,
  remove = true,
}: {
  section: Section
  things: Things
  bare?: boolean
  switches?: boolean
  remove?: boolean
}) {
  switch (section) {
    case 'general':
      return <General things={things} switches={switches} remove={remove} />
    case 'code':
      // Where General has the switches, Move issues is said there, once.
      return <CodeAndIssues things={things} bare={bare} moveIssues={!switches} />
    case 'rules':
      return <RulesScreen bare={bare} />
    case 'running':
      return <Running things={things} />
    case 'notes':
      return <NotesSection things={things} />
  }
}

export { words }
