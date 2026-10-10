import type { EdgeWork } from '../home/EdgeSheet/EdgeSheet'
import { NeedLine } from '../home/NeedLine/NeedLine'
import { Button } from '../primitives/Button/Button'
import { PUBLISH, READY } from './home'

/*
 * The home in small, as the edge of the screen shows it at 14:32 on a
 * Thursday: two calls that wait on you, and the work in progress across
 * three projects, which the edge only counts. The island and the menu bar's
 * sheet show these.
 */

export interface EdgeDemoCall {
  id: string
  kind: string
  project: typeof PUBLISH.project
  task: string
  title: string
  command?: string
  brief?: string
}

export const EDGE_NEEDS: readonly EdgeDemoCall[] = [
  { id: 'h212', kind: PUBLISH.kind, project: PUBLISH.project, task: PUBLISH.task, title: PUBLISH.title, command: PUBLISH.command },
  {
    id: 'm416',
    kind: READY.kind,
    project: READY.project,
    task: READY.task,
    title: READY.title,
    brief: `${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`,
  },
]

/** Four in progress, one of them held for a reset. */
export const EDGE_WORK: EdgeWork = { inProgress: 4, held: 1 }

/** The MacBook Air 15's notch, in points. */
export const NOTCH = { width: 179, height: 32 }

/** A demo call as the app fills it: a permission with its command and answers, a ready task with Review. */
export const edgeLineOf = ({ id, command, brief, ...call }: EdgeDemoCall, onOpen?: () => void) => (
  <NeedLine
    key={id}
    {...call}
    {...(onOpen === undefined ? {} : { onOpen })}
    {...(command === undefined ? {} : { command })}
    {...(brief === undefined ? {} : { brief })}
    actions={
      command === undefined ? (
        <Button size="small">Review</Button>
      ) : (
        <>
          <Button size="small">Deny</Button>
          <Button size="small" variant="signal">
            Allow once
          </Button>
        </>
      )
    }
  />
)
