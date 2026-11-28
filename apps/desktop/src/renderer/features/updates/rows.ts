import { type FleetUpdate, type UpdateRow, updateReadyText, WORKER_UPDATE_COMMAND } from '@althar/ui'
import { type HomeUpdateOffer, homeWelcomeText } from '@althar/ui/screens'

import type { UpdateModel } from '../../shared/useUpdate'

/*
 * The bar's Updates, a row an update, in the words the rest of the window
 * says it with: Althar's own (what its line in the bar said: ready with
 * Restart, installing when you quit while tasks run here, restarting, or a
 * restart that didn't happen); the window's home's, where that's another
 * computer, run from here as Settings runs it; and its workers', as
 * Computers says them.
 */

export const rowsText = {
  installsOnQuit: 'Installs when you quit, as tasks are running here.',
  restarting: (version: string) => `Restarting into Althar ${version}`,
  couldNotRestart: (version: string) => `Couldn’t restart into Althar ${version}`,
  tryAgain: 'Try again',
  restart: updateReadyText.restart,
  home: (name: string, newest: string) => `${name} can update to ${newest}`,
  byHand: (name: string) => `Run this on ${name} to update it.`,
  update: 'Update',
  workers: (count: number) => (count === 1 ? '1 worker' : `${count} workers`),
  althar: (version: string) => `Althar ${version}`,
}

/** Althar's own update on this computer: none where none is ready. */
export const appRow = (ready: UpdateModel['ready']): UpdateRow | null => {
  if (ready === null) return null
  const { version, onRestart, restarting, error } = ready
  const who = rowsText.althar(version)
  if (restarting === true)
    return { kind: 'app', tone: 'running', title: rowsText.restarting(version), who, end: { kind: 'spinner' }, hides: false }
  if (error !== undefined)
    return {
      kind: 'app',
      tone: 'failed',
      title: rowsText.couldNotRestart(version),
      line: error,
      who,
      ...(onRestart === undefined ? {} : { end: { kind: 'press', label: rowsText.tryAgain, onPress: onRestart } }),
      hides: true,
    }
  // While work runs there is no Restart: it installs as Althar quits.
  if (onRestart === undefined)
    return { kind: 'app', tone: 'quiet', title: updateReadyText.ready(version), line: rowsText.installsOnQuit, who, hides: true }
  return {
    kind: 'app',
    tone: 'offer',
    title: updateReadyText.ready(version),
    who,
    end: { kind: 'press', label: rowsText.restart, onPress: onRestart },
    hides: true,
  }
}

export interface HomeRowInput {
  readonly name: string
  /** The newest release published, where it's known. */
  readonly newest: string | null
  readonly offer: HomeUpdateOffer
  readonly onUpdate?: (() => void) | undefined
  readonly onCancelUpdate?: (() => void) | undefined
  /** Its restart stops its tasks: the press asks first, in the row. */
  readonly asking: boolean
  readonly onAsk: (asking: boolean) => void
}

/** The window's home's update, as `useHomeUpdating` runs it: none while the newest is looked for, or none is newer. */
export const homeRow = ({ name, newest, offer, onUpdate, onCancelUpdate, asking, onAsk }: HomeRowInput): UpdateRow | null => {
  const t = homeWelcomeText.update
  const run = offer.run
  const base = { kind: 'home', who: name } as const
  if (offer.release !== undefined || (newest === null && (run === undefined || run.state === 'idle'))) return null
  const title = rowsText.home(name, newest ?? '')
  if (run === undefined)
    return { ...base, tone: 'offer', title, line: rowsText.byHand(name), end: { kind: 'copy', command: offer.command }, hides: true }
  switch (run.state) {
    case 'idle': {
      const busy = run.busy ?? 0
      if (asking && busy > 0 && onUpdate !== undefined)
        return {
          ...base,
          tone: 'asking',
          title: t.stop(busy),
          line: t.stopLine(name),
          end: {
            kind: 'ask',
            label: t.anyway,
            onPress: () => {
              onAsk(false)
              onUpdate()
            },
            onCancel: () => onAsk(false),
          },
          hides: false,
        }
      return {
        ...base,
        tone: 'offer',
        title,
        line: busy > 0 ? t.busy(busy, name) : t.line(name),
        ...(onUpdate === undefined
          ? {}
          : { end: { kind: 'press', label: rowsText.update, onPress: busy > 0 && run.moves !== true ? () => onAsk(true) : onUpdate } }),
        hides: true,
      }
    }
    case 'confirm':
      return {
        ...base,
        tone: 'asking',
        title: t.moves.title(name, run.to),
        line: t.moves.line(name, run.from, run.busy ?? 0),
        ...(onUpdate === undefined || onCancelUpdate === undefined
          ? {}
          : { end: { kind: 'ask', label: t.moves.press, onPress: onUpdate, onCancel: onCancelUpdate } }),
        hides: false,
      }
    case 'running': {
      const steps = [t.steps.getting, t.steps.restarting(name), t.steps.reconnecting]
      const at = (['getting', 'restarting', 'reconnecting'] as const).indexOf(run.step)
      return { ...base, tone: 'running', title: t.running(name), line: steps[at], end: { kind: 'steps', steps, at }, hides: false }
    }
    case 'failed':
      return {
        ...base,
        tone: 'failed',
        title: t.failed(name),
        line: run.problem,
        ...(onUpdate === undefined ? {} : { end: { kind: 'press', label: t.tryAgain, onPress: onUpdate } }),
        hides: true,
      }
  }
}

/** The home's workers' update, as the kit's `fleetUpdate` says it: none where no worker has one. */
export const workersRow = (
  fleet: FleetUpdate | null,
  count: number,
  onUpdate: (ids: readonly string[]) => void,
  onCancel: (id: string) => void,
): UpdateRow | null => {
  if (fleet === null) return null
  const base = { kind: 'workers', title: fleet.title, line: fleet.line, who: fleet.one?.name ?? rowsText.workers(count) } as const
  const cancel = fleet.cancel
  switch (fleet.state) {
    case 'offer':
    case 'failed':
      return {
        ...base,
        tone: fleet.state,
        ...(fleet.press === undefined || fleet.ids.length === 0
          ? {}
          : { end: { kind: 'press', label: fleet.press, onPress: () => onUpdate(fleet.ids) } }),
        hides: true,
      }
    case 'byItself':
      return { ...base, tone: 'quiet', end: { kind: 'copy', command: WORKER_UPDATE_COMMAND }, hides: true }
    case 'waiting':
      return {
        ...base,
        tone: 'quiet',
        ...(cancel === undefined ? {} : { end: { kind: 'cancel', onPress: () => onCancel(cancel) } }),
        hides: true,
      }
    case 'running':
      return {
        ...base,
        tone: 'running',
        end:
          fleet.step === undefined
            ? { kind: 'count', done: fleet.done ?? 0, of: fleet.of ?? 0 }
            : { kind: 'steps', steps: fleet.step.names, at: fleet.step.at },
        hides: false,
      }
    case 'done':
      return { ...base, tone: 'done', hides: false }
  }
}

/** Where an update put aside still is: Althar's own in About, a home's and its workers' in Computers. */
export const whereStill = {
  app: { where: 'Settings › About Althar', section: 'about' },
  home: { where: 'Settings › Computers', section: 'computers' },
  workers: { where: 'Settings › Computers', section: 'computers' },
} as const
