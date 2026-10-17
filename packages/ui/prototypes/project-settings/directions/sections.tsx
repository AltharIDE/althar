// What B, C and E share: the project's settings by section, each the app's own setting rows, and its rules screen itself where they are about access.
import { Button, type IconName, LinkButton } from '../../../src/index'
import {
  AllowEverything,
  AppWide,
  TrackerRows,
  Conflicts,
  Identity,
  LinkRow,
  MoveIssues,
  Notes,
  overlay,
  RemoveRow,
  RulesRow,
  RunRows,
  SettingList,
  type Things,
  WhereRows,
} from '../parts'
import css from '../parts.module.css'

import { RulesView } from '../../../../../apps/desktop/src/renderer/features/rules/RulesView'
import { useRules } from '../../../../../apps/desktop/src/renderer/features/rules/useRules'

export const SECTIONS = ['general', 'connections', 'rules', 'running', 'notes', 'remove'] as const
export type Section = (typeof SECTIONS)[number]

export const GROUPS: ReadonlyArray<ReadonlyArray<Section>> = [['general', 'connections'], ['rules', 'running', 'notes'], ['remove']]

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly lede: string; readonly icon: IconName }>> = {
  general: { title: 'General', lede: 'Its name and colour, and where its work goes.', icon: 'pencil' },
  connections: {
    title: 'Code and issues',
    lede: 'The code its tasks change, and the trackers its issues are in: none, one or several.',
    icon: 'plug',
  },
  rules: { title: 'Rules and access', lede: 'What its agents may do without asking you.', icon: 'lock' },
  running: { title: 'Running', lede: 'What Run starts, with no agent, and what else is kept to run.', icon: 'play' },
  notes: {
    title: 'Notes',
    lede: 'What you decided in conversation, that the code doesn’t show. Every coordinator session starts with them.',
    icon: 'quote',
  },
  remove: { title: 'Remove project', lede: 'Take it out of Althar.', icon: 'close' },
}

/** A section's dot: a connection that needs the person. */
export const yoursIn = (section: Section, things: Things) => section === 'connections' && things.troubles > 0

/** The rules screen, as it is, inside a section: its own way back and scrolling left to the page around it. */
export function EmbeddedRules() {
  const model = useRules('p1')
  return (
    <div className={css.embed}>
      <RulesView model={model} onBack={() => undefined} />
    </div>
  )
}

export function SectionBody({ section, things, full = true }: { section: Section; things: Things; full?: boolean }) {
  switch (section) {
    case 'general':
      return (
        <>
          <Identity things={things} />
          <SettingList>
            <WhereRows things={things} />
          </SettingList>
        </>
      )
    case 'connections':
      return (
        <>
          <h3 className={css.groupTitle}>Code</h3>
          <SettingList>{things.host !== null && <LinkRow link={things.host} things={things} />}</SettingList>
          <div className={css.row}>
            <LinkButton onClick={things.openRepositories}>Add or change repositories</LinkButton>
          </div>
          <h3 className={css.groupTitle}>Issues</h3>
          <SettingList>
            <TrackerRows things={things}>
              <MoveIssues things={things} indent />
            </TrackerRows>
          </SettingList>
          <AppWide things={things} />
        </>
      )
    case 'rules':
      return (
        <>
          <SettingList>
            {/* The rules screen has Allow everything of its own, at its head. */}
            {!full && <AllowEverything things={things} />}
            <Conflicts things={things} />
            {!full && <RulesRow things={things} />}
          </SettingList>
          {full && <EmbeddedRules />}
        </>
      )
    case 'running':
      return (
        <>
          <SettingList>
            <RunRows things={things} />
          </SettingList>
          <div className={css.row}>
            <Button size="small" onClick={() => overlay.set({ runs: true })}>
              Edit list
            </Button>
          </div>
        </>
      )
    case 'notes':
      return <Notes things={things} />
    case 'remove':
      return (
        <SettingList>
          <RemoveRow things={things} />
        </SettingList>
      )
  }
}
