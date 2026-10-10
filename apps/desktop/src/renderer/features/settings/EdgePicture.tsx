import { EdgeRow, EdgeScene, EdgeSheet, Island, Logo, ProjectInk, type ProjectRef, TaskStatus } from '@althar/ui'

import { kindWords } from '../../shared/calls'

/*
 * What Althar would put at the edge of the screen, drawn with the real
 * island and sheet in a slice of the screen: what waits on the person and
 * what runs, as the home has it now. With nothing under way it shows a
 * moment that has some, so there is something to see.
 */

/** A line of the edge's sheet, as the home would give it. */
export interface EdgeLine {
  readonly id: string
  readonly status: TaskStatus
  readonly project: ProjectRef
  readonly title: string
  readonly kind?: string
  readonly meta?: string
}

/** What waits and what runs now, for the pictures. */
export interface EdgeGlance {
  readonly waiting: number
  readonly running: number
  readonly lines: ReadonlyArray<EdgeLine>
}

const MERIDIAN: ProjectRef = { seed: 'meridian', ink: ProjectInk.Ochre, name: 'Meridian' }
const HALYARD: ProjectRef = { seed: 'halyard', ink: ProjectInk.Teal, name: 'Halyard' }

/** A moment with work in it, for a picture when nothing is under way. */
export const EXAMPLE: EdgeGlance = {
  waiting: 2,
  running: 1,
  lines: [
    { id: 'e1', status: TaskStatus.Yours, project: MERIDIAN, title: 'Publish the SDK to npm', kind: kindWords.permission, meta: '2m' },
    { id: 'e2', status: TaskStatus.Yours, project: HALYARD, title: 'Retry the checkout call', kind: kindWords.ready, meta: '9m' },
    { id: 'e3', status: TaskStatus.Running, project: MERIDIAN, title: 'Name the usage limits better', meta: '4 min' },
  ],
}

/** The glance to draw: the home's, or the example where nothing waits or runs. */
export const shownGlance = (glance: EdgeGlance | undefined): EdgeGlance =>
  glance === undefined || glance.lines.length === 0 ? EXAMPLE : glance

const sheetOf = (glance: EdgeGlance, tone: 'ink' | 'paper') => {
  const lines = glance.lines.slice(0, 3)
  const row = (line: EdgeLine) => (
    <EdgeRow
      key={line.id}
      status={line.status}
      project={line.project}
      title={line.title}
      {...(line.kind === undefined ? {} : { kind: line.kind })}
      {...(line.meta === undefined ? {} : { meta: line.meta })}
    />
  )
  return (
    <EdgeSheet
      tone={tone}
      waiting={glance.waiting}
      working={glance.running}
      needs={lines.filter((line) => line.status === TaskStatus.Yours).map(row)}
      work={lines.filter((line) => line.status !== TaskStatus.Yours).map(row)}
    />
  )
}

/** Round the notch: the island open, as pointing at it opens it. */
export function IslandPicture({ glance }: { glance: EdgeGlance }) {
  return (
    <EdgeScene
      notch
      top={
        <Island notch={{ width: 180, height: 32 }} waiting={glance.waiting} running={glance.running} open>
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
