import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import s from './Computers.module.css'
import { type FleetUpdate, WORKER_UPDATE_COMMAND, type WorkerUpdateText, workerUpdateText } from './workerUpdate'

/*
 * The workers' update as one strip flat on Computers' sheet, as a home's
 * update sits in its Settings: at the head of Workers for all of them, and
 * over a worker opened out for that one. Its press; waiting for a task or a
 * connection, with Cancel; its steps under way, or how many are done of all;
 * why it stopped, with Try again; done, a tick. Where the window can't ask
 * (an older worker, or one set up by hand) or the update failed, the command
 * that runs it on the worker, folded away under it.
 */

const tileOf = (state: FleetUpdate['state']): IconName =>
  state === 'failed' ? 'problem' : state === 'waiting' ? 'clock' : state === 'done' ? 'check' : 'download'

export function WorkerUpdateStrip({
  fleet,
  onUpdate,
  onCancel,
  className,
  text,
}: {
  fleet: FleetUpdate
  /** Asks these workers to update; without it, the strip only says where their update stands. */
  onUpdate?: ((ids: readonly string[]) => void) | undefined
  onCancel?: ((id: string) => void) | undefined
  className?: string | undefined
  text?: Partial<WorkerUpdateText> | undefined
}) {
  const t = { ...workerUpdateText, ...text }
  const { state } = fleet
  const cancel = fleet.cancel
  return (
    <section className={cx(s.updateStrip, className)} aria-label={fleet.title}>
      <div className={s.update} data-state={state}>
        <span className={s.updateTile} aria-hidden="true">
          {state === 'running' ? <Spinner size="small" /> : <Icon name={tileOf(state)} size={16} />}
        </span>
        <span className={s.updateText} aria-live="polite">
          <span className={s.updateTitle}>{fleet.title}</span>
          {fleet.line !== '' && (
            <span className={s.updateLine} title={fleet.line}>
              {fleet.line}
            </span>
          )}
        </span>
        <span className={s.updateEnd}>
          {state === 'running' ? (
            fleet.step !== undefined ? (
              <StepTrack steps={trackOf(fleet.step.names, fleet.step.at)} className={s.updateTrack} text={{ label: fleet.title }} />
            ) : (
              <span className={s.updateCount}>{t.running.of(fleet.done ?? 0, fleet.of ?? 0)}</span>
            )
          ) : state === 'waiting' ? (
            cancel !== undefined && onCancel !== undefined && <LinkButton onClick={() => onCancel(cancel)}>{t.press.cancel}</LinkButton>
          ) : fleet.press !== undefined && onUpdate !== undefined && fleet.ids.length > 0 ? (
            <Button variant="signal" size="small" onClick={() => onUpdate(fleet.ids)}>
              {fleet.press}
            </Button>
          ) : null}
        </span>
      </div>
      {fleet.byHand && (
        <Disclosure className={s.byHand}>
          <DisclosureTrigger>
            <LinkButton className={s.byHandTrigger}>
              {fleet.one === null ? t.byHand.many : t.byHand.one(fleet.one.name)}
              <Caret />
            </LinkButton>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={s.byHandBody}>
              <span className={s.lineToRun}>
                <Code className={s.lineToRunText}>{WORKER_UPDATE_COMMAND}</Code>
                <CopyButton value={WORKER_UPDATE_COMMAND} ghost />
              </span>
              <span className={s.addressHint}>{t.byHand.note}</span>
            </div>
          </Fold>
        </Disclosure>
      )}
    </section>
  )
}
