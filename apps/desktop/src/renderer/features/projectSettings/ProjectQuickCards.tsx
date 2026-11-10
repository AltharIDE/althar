import { ControlGrid, type ControlPlace, ControlToggle, Icon, type IconName } from '@althar/ui'

import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * What is changed most often in a project, one press each, as round switches
 * at the top of its side, as Althar's own quick cards are in its Settings: what
 * its leads push as they go, whether screenshots go to its pull requests,
 * whether its issues follow its tasks, and whether a lead resolves merge
 * conflicts. A card's circle turns it on or off; its name opens the Tasks
 * where each is said. One under another, in the order of a task's life.
 */

export const quickText = {
  push: { title: 'Push as it goes', on: 'Each commit' },
  screenshots: { title: 'Screenshots', on: 'On pull requests' },
  issues: { title: 'Issues follow', on: 'In Progress to Done' },
  conflicts: { title: 'Conflicts', on: 'The lead resolves them' },
  off: 'Off',
}

interface Card {
  readonly key: string
  readonly title: string
  readonly on: string
  readonly checked: boolean
  readonly set: (on: boolean) => void
  readonly glyph: IconName
}

/** The cards, as the project's rules stand. */
export const cardsOf = (model: ProjectSettingsModel): ReadonlyArray<Card> => {
  const rules = model.rules
  if (rules === null) return []
  return [
    { key: 'push', ...quickText.push, checked: rules.pushCommits, set: model.setPushCommits, glyph: 'up' },
    { key: 'screenshots', ...quickText.screenshots, checked: rules.postScreenshots, set: model.setPostScreenshots, glyph: 'image' },
    { key: 'issues', ...quickText.issues, checked: rules.moveIssues, set: model.setMoveIssues, glyph: 'issues' },
    { key: 'conflicts', ...quickText.conflicts, checked: rules.resolveConflicts, set: model.setResolveConflicts, glyph: 'conflict' },
  ]
}

/** One under another down the side. */
const placeOf = (i: number): ControlPlace => ({ column: [1, 3], row: [1 + i * 2, 3 + i * 2] })

export function ProjectQuickCards({ model, onOpen }: { model: ProjectSettingsModel; onOpen: () => void }) {
  const cards = cardsOf(model)
  // Until its rules are read there are none to turn: nothing, so the side doesn't draw cards that then change.
  if (cards.length === 0) return null
  return (
    <ControlGrid row={28} columns={2}>
      {cards.map((card, i) => (
        <ControlToggle
          key={card.key}
          title={card.title}
          line={card.checked ? card.on : quickText.off}
          on={card.checked}
          onChange={card.set}
          glyph={<Icon name={card.glyph} size={16} />}
          onOpen={onOpen}
          place={placeOf(i)}
        />
      ))}
    </ControlGrid>
  )
}
