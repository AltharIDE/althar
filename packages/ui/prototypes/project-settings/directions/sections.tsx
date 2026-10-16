// What B, C and E share: the project's settings by section, each the app's own setting rows, and its rules screen itself where they are about access.
import { Button, type IconName, LinkButton } from '../../../src/index'
import {
  AllowEverything,
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
    title: 'Repositories and connections',
    lede: 'The code its tasks change, and who Althar is on its code host and tracker.',
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
          <SettingList>
            {things.host !== null && <LinkRow link={things.host} things={things} />}
            {things.tracker !== null && <LinkRow link={things.tracker} things={things} />}
            <MoveIssues things={things} indent />
          </SettingList>
          {things.tracker === null && <p className={css.quiet}>No tracker yet: once its tasks name issues, their tracker shows here.</p>}
          <div className={css.row}>
            <LinkButton onClick={things.openRepositories}>Add or change repositories</LinkButton>
          </div>
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
