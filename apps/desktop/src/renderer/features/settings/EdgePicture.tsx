import { EdgeScene, EdgeSheet, type EdgeWork, Island, Logo, NeedLine, ProjectInk, type ProjectRef } from '@althar/ui'

import { kindWords } from '../../shared/calls'
import type { Need } from '../home/needs'

/*
 * What Althar would put at the edge of the screen, drawn with the real
 * island and sheet in a slice of the screen: what waits on the person and
 * how much is in progress, as the home has it now. With nothing under way
 * it shows a moment that has some, so there is something to see.
 */

/** A call of the edge's sheet, as the home would give it. */
export type EdgeCall = Pick<Need, 'id' | 'kind' | 'project' | 'title' | 'command' | 'brief'>

/** What waits and how much is in progress now, for the pictures. */
export interface EdgeGlance {
  readonly waiting: number
  /** The first few that wait. */
  readonly needs: ReadonlyArray<EdgeCall>
  readonly work: EdgeWork
}

const MERIDIAN: ProjectRef = { seed: 'meridian', ink: ProjectInk.Ochre, name: 'Meridian' }
const HALYARD: ProjectRef = { seed: 'halyard', ink: ProjectInk.Teal, name: 'Halyard' }

/** A moment with work in it, for a picture when nothing is under way. */
export const EXAMPLE: EdgeGlance = {
  waiting: 2,
  needs: [
    { id: 'e1', kind: kindWords.permission, project: MERIDIAN, title: 'Publish the SDK to npm', command: 'npm publish --access public' },
    { id: 'e2', kind: kindWords.ready, project: HALYARD, title: 'Retry the checkout call', brief: 'halyard #212 · checks passed · +48 −6' },
  ],
  work: { inProgress: 3, held: 1 },
}

/** The glance to draw: the home's, or the example where nothing waits or is in progress. */
export const shownGlance = (glance: EdgeGlance | undefined): EdgeGlance =>
  glance === undefined || (glance.needs.length === 0 && glance.work.inProgress === 0) ? EXAMPLE : glance

const sheetOf = (glance: EdgeGlance, tone: 'ink' | 'paper') => (
  <EdgeSheet
    tone={tone}
    waiting={glance.waiting}
    needs={glance.needs.map((need) => (
      <NeedLine
        key={need.id}
        kind={need.kind}
        project={need.project}
        title={need.title}
        {...(need.command === undefined ? {} : { command: need.command })}
        {...(need.brief === undefined ? {} : { brief: need.brief })}
      />
    ))}
    work={glance.work}
  />
)

/** Round the notch: the island open, as pointing at it opens it. */
export function IslandPicture({ glance }: { glance: EdgeGlance }) {
  return (
    <EdgeScene
      notch
      top={
        <Island notch={{ width: 180, height: 32 }} waiting={glance.waiting} open>
          {sheetOf(glance, 'ink')}
        </Island>
      }
    />
  )
}

/** In the menu bar: the mark with its count, and its sheet open under it. */
export function MenuPicture({ glance }: { glance: EdgeGlance }) {
  return (
    <EdgeScene
      menuItem={
        <>
          <Logo size={12} />
          {glance.waiting > 0 ? glance.waiting : null}
        </>
      }
      sheet={sheetOf(glance, 'paper')}
    />
  )
}
