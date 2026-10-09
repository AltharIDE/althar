import { TaskStatus } from '../foundations/vocabulary'
import { EdgeRow } from '../home/EdgeRow/EdgeRow'
import { NeedCommand } from '../home/NeedCard/NeedCard'
import { Button } from '../primitives/Button/Button'
import { HALYARD, MERIDIAN, PUBLISH, READY, TESSERA } from './home'

/*
 * The home in small, as the edge of the screen shows it at 14:32 on a
 * Thursday: two calls that wait on you and the work in progress across
 * three projects. The island and the menu bar's sheet list these.
 */

export interface EdgeDemoRow {
  id: string
  status: TaskStatus
  project: typeof MERIDIAN
  title: string
  kind?: string
  meta?: string
  command?: string
}

export const EDGE_NEEDS: readonly EdgeDemoRow[] = [
  {
    id: 'h212',
    status: TaskStatus.Yours,
    project: PUBLISH.project,
    title: PUBLISH.title,
    kind: PUBLISH.kind,
    meta: PUBLISH.at,
    command: PUBLISH.command,
  },
  { id: 'm416', status: TaskStatus.Yours, project: READY.project, title: READY.title, kind: READY.kind, meta: READY.at },
]

export const EDGE_WORK: readonly EdgeDemoRow[] = [
  {
    id: 'm418',
    status: TaskStatus.Running,
    project: MERIDIAN,
    title: 'Repair token refresh on privilege change',
    meta: 'Repair · Sonnet 5 · 6m',
  },
  {
    id: 'h207',
    status: TaskStatus.Running,
    project: HALYARD,
    title: 'Rate-limit the admin routes per token',
    meta: 'Implement · Codex · 41m',
  },
  { id: 't88', status: TaskStatus.Running, project: TESSERA, title: 'Tokens for the project inks', meta: 'Plan · Sonnet 5 · 1h 32m' },
  {
    id: 'h209',
    status: TaskStatus.Paused,
    project: HALYARD,
    title: 'Retry failed upstream calls with backoff',
    meta: 'Waits for Sonnet 5’s reset at 14:50',
  },
]

/** The MacBook Air 15's notch, in points. */
export const NOTCH = { width: 179, height: 32 }

/** A demo row as the app fills it: a permission with its command and answers, a ready task with Review. */
export const edgeRowOf = ({ id, command, ...row }: EdgeDemoRow, onOpen?: () => void) => (
  <EdgeRow
    key={id}
    {...row}
    {...(onOpen === undefined ? {} : { onOpen })}
    {...(command === undefined ? {} : { detail: <NeedCommand command={command} /> })}
    {...(row.kind === undefined
      ? {}
      : {
          actions:
            command === undefined ? (
              <Button size="small">Review</Button>
            ) : (
              <>
                <Button size="small" variant="signal">
                  Allow once
                </Button>
                <Button size="small">Deny</Button>
              </>
            ),
        })}
  />
)
