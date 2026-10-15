import type { BackgroundCommand } from '@althar/contracts'
import type { RunCardProps, RunningProcess } from '@althar/ui'

import type { RunContent } from './thread'
import { ago, running } from './time'

/*
 * What runs behind a conversation, as the Running pill over its composer
 * shows it: what an agent left running, and what Althar runs of the project
 * itself (ADR-022, ADR-023).
 */

/** Where one answers, as the pill says it: the address without its scheme or a bare trailing slash. */
export const addressOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** What runs, each with how long it has run, or when it ended by itself and how; with `where`, where each runs. */
export const runningOf = (
  background: ReadonlyArray<BackgroundCommand & { readonly where?: string }>,
  now: string,
  { where = false }: { readonly where?: boolean } = {},
): ReadonlyArray<RunningProcess> =>
  background.map((command) => ({
    id: command.id,
    command: command.command,
    ...(command.label === undefined || command.label === command.command ? {} : { label: command.label }),
    ...(where && command.where !== undefined ? { where: command.where } : {}),
    ...(command.url === null ? {} : { url: addressOf(command.url) }),
    ...(command.ended === null
      ? { since: running(command.startedAt, now) }
      : { since: ago(command.ended.at, new Date(now)), exited: command.ended.code }),
  }))

/** A run's card as the thread keeps it: where, the command, where it answers, for how long, and how it ended. */
export const runCardOf = (run: RunContent, now: string): Pick<RunCardProps, 'where' | 'command' | 'url' | 'since' | 'ended'> => ({
  where: run.where,
  command: run.command,
  ...(run.url === null ? {} : { url: addressOf(run.url) }),
  since: run.ended === null ? running(run.startedAt, now) : ago(run.ended.at, new Date(now)),
  ...(run.ended === null
    ? {}
    : { ended: { code: run.ended.code, stopped: run.ended.stopped, ...(run.ended.last === null ? {} : { last: run.ended.last }) } }),
})
