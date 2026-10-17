// Scrappy: the project's settings by section, as every direction shows them: what each is called and says, and what is in it, from the app's own screens and rows.
import type { ReactNode } from 'react'

import { Button, ControlGrid, ControlToggle, Heading, Icon, type IconName, SettingList } from '../../src/index'
import {
  AllowEverything,
  AppWide,
  Conflicts,
  Identity,
  MoveIssues,
  Notes,
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
import { useRepositories } from '../../../../apps/desktop/src/renderer/features/repositories/useRepositories'
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

export function RepositoriesScreen({ bare = true }: { bare?: boolean }) {
  return (
    <Embed bare={bare}>
      <RepositoriesView model={useRepositories(PROJECT)} connections={useConnections()} onBack={leave} />
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

/** Where the page has the quick cards, its switches are there, not here again. */
export function General({ things, switches = true }: { things: Things; switches?: boolean }) {
  return (
    <div className={css.stack}>
      <Identity things={things} />
      {switches && (
        <div>
          <Sub title="Every task" note="What each of its tasks follows, from its next request on." />
          <SettingList>
            <AllowEverything things={things} />
            <Conflicts things={things} />
          </SettingList>
        </div>
      )}
      <div className={css.away}>
        <SettingList>
          <RemoveRow things={things} />
        </SettingList>
      </div>
    </div>
  )
}

export function CodeAndIssues({ things, bare = true }: { things: Things; bare?: boolean }) {
  return (
    <div className={css.stack}>
      <RepositoriesScreen bare={bare} />
      <div>
        <Sub title="Trackers" note="Where its issues are. Tasks start from them, and move them as they go." />
        <SettingList>
          <TrackerRows things={things}>
            <MoveIssues things={things} indent />
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

export function NotesSection({ things }: { things: Things }) {
  return <Notes things={things} />
}

/** A section's body, whichever it is. */
export function Body({
  section,
  things,
  bare = true,
  switches = true,
}: {
  section: Section
  things: Things
  bare?: boolean
  switches?: boolean
}) {
  switch (section) {
    case 'general':
      return <General things={things} switches={switches} />
    case 'code':
      return <CodeAndIssues things={things} bare={bare} />
    case 'rules':
      return <RulesScreen bare={bare} />
    case 'running':
      return <Running things={things} />
    case 'notes':
      return <NotesSection things={things} />
  }
}

export { words }
