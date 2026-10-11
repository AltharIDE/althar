import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './UpdateReady.module.css'

/*
 * A newer Althar is downloaded and in place: one quiet line, in the window's
 * bar or Settings' foot, never a banner. Restart is there only when the
 * consumer may restart now; while work runs there is none, and the line
 * says the update installs as Althar quits. A restart that didn't happen
 * says why, and Restart stays to try again.
 */

export interface UpdateReadyText {
  ready: (version: string) => string
  restart: string
  restarting: string
  /** Said while there is no Restart: work runs. */
  onQuit: string
  failed: (why: string) => string
}

export const updateReadyText: UpdateReadyText = {
  ready: (version) => `Althar ${version} is ready`,
  restart: 'Restart',
  restarting: 'Restarting…',
  onQuit: 'Installs when you quit',
  failed: (why) => `Couldn’t restart: ${why}`,
}

export type UpdateReadyProps = RootProps<
  'output',
  {
    /** The version that is ready, as words: 0.1.1. */
    version: string
    /** Restarts into it. Leave it out while work runs: the line then says it installs as Althar quits. */
    onRestart?: () => void
    /** A restart is under way. */
    restarting?: boolean
    /** Why the last restart didn't happen. */
    error?: string
    text?: Partial<UpdateReadyText>
  }
>

export function UpdateReady({ version, onRestart, restarting = false, error, text, className, ...rest }: UpdateReadyProps) {
  const t = { ...updateReadyText, ...text }
  return (
    // An output is a live status: the line is read out as it appears.
    <output className={cx(s.line, className)} {...rest}>
      <span className={s.ready}>{t.ready(version)}</span>
      {restarting ? (
        <span>{t.restarting}</span>
      ) : onRestart === undefined ? (
        <span>{t.onQuit}</span>
      ) : (
        <LinkButton onClick={onRestart}>{t.restart}</LinkButton>
      )}
      {error !== undefined && !restarting && <span className={s.error}>{t.failed(error)}</span>}
    </output>
  )
}
