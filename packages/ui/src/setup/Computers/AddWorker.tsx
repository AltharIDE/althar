import { useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { AskCard } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field } from '../../primitives/Field/Field'
import { Problem } from '../../primitives/Problem/Problem'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Computers.module.css'

/*
 * Add a worker (ADR-103), as easily as connecting a home: an SSH address, and Althar installs the worker there as a
 * service, from the signed release, and has the home sign its key; or, for a machine without SSH, a one-time code and
 * the one line that takes it. Its steps show as they go, each with what it did, a host key to trust the first time,
 * and where it stopped with what to do. Once it connects, its projects and agents are picked on its own sheet.
 *
 * A home that takes workers only by its operator's certificates (or an older one) gets the steps by hand, as before.
 */

/** The steps of adding a worker over SSH, in order. */
export const WORKER_STEP_COUNT = 5

/** Where adding a worker over SSH stands, as the window words it. */
export interface WorkerSetupView {
  /** The machine, as the person gave it. */
  name: string
  phase: 'running' | 'trust' | 'enroll' | 'failed' | 'done'
  /** The step it is at, 0 to 4; 5 once done. */
  at: number
  /** What step 1 found: Linux · arm64 · 62 GB free. */
  facts?: string | undefined
  /** The release, while it comes: how far, and its size. */
  progress?: { fraction: number; megabytes: number; sending: boolean } | undefined
  version?: string | undefined
  hostKey?: { fingerprint: string } | undefined
  /** Where it stopped: what happened, what to do, and whether trying again can help. */
  problem?: { title: string; body?: string | undefined; command?: string | undefined; retry: boolean } | undefined
  /** A line for the machine's administrator, where its login doesn't linger: without it the worker stops at logout. */
  linger?: string | undefined
}

/** A one-time code for a machine without SSH, and the line that takes it there. */
export interface WorkerCodeView {
  /** The line to run on the machine; null while it is being made. */
  command: string | null
  /** How long it still works, as the person reads it: 9 minutes. */
  lasts: string | null
  failed?: string | null | undefined
}

export interface AddWorkerText {
  title: (home: string) => string
  note: string
  overSsh: string
  withCode: string
  address: string
  addressHint: string
  add: string
  cancel: string
  close: string
  steps: (home: string) => readonly string[]
  sent: (done: number, all: number) => string
  downloading: (done: number, all: number) => string
  checked: (version: string) => string
  enrolled: (home: string) => string
  started: string
  firstTime: string
  isThisKey: (name: string) => string
  keyWhere: string
  trust: string
  again: string
  stop: string
  linger: string
  waiting: string
  codeNote: (home: string) => string
  making: string
  codeLasts: (time: string) => string
  shows: string
}

export const addWorkerText: AddWorkerText = {
  title: (home) => `Add a worker to ${home}`,
  note: 'A Linux computer this home runs tasks on, one at a time. Althar installs the worker there, with its agents, as a service that keeps itself up to date.',
  overSsh: 'Over SSH',
  withCode: 'With a code',
  address: 'SSH address',
  addressHint: 'As you would type it after ssh: a name from your SSH config, or user@host.',
  add: 'Add worker',
  cancel: 'Cancel',
  close: 'Close',
  steps: (home) => ['Reach the machine', 'Look it over', 'Install the worker', `Enroll it with ${home}`, 'Start its service'],
  sent: (done, all) => `Sending from this computer · ${done} of ${all} MB`,
  downloading: (done, all) => `Downloading · ${done} of ${all} MB`,
  checked: (version) => `${version}, signature checked`,
  enrolled: (home) => `Signed by ${home}`,
  started: 'Starts with the machine, updates itself',
  firstTime: 'First time on this machine',
  isThisKey: (name) => `Is this ${name}’s key?`,
  keyWhere: 'On the machine, ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub prints it.',
  trust: 'Trust and go on',
  again: 'Try again',
  stop: 'Stop',
  linger: 'Its login stops its services when it logs out. To keep the worker running, have its administrator run:',
  waiting: 'Waiting for it to connect…',
  codeNote: (home) => `Run this on the machine. It installs the worker and enrolls it with ${home}. The code works once.`,
  making: 'Making a code…',
  codeLasts: (time) => `Works for ${time}`,
  shows: 'It shows in Computers once it connects.',
}

export interface AddWorkerDialogProps {
  /** The home it joins, by name. */
  home: string
  way: 'ssh' | 'code'
  onWay: (way: 'ssh' | 'code') => void
  /** This Althar can reach the person's SSH keys; a Flatpak's can't, and adds with a code only. */
  ssh?: boolean | undefined
  address: string
  onAddress: (value: string) => void
  /** What is wrong with the address, at its field. */
  addressError?: string | null | undefined
  onAdd: () => void
  /** Adding it over SSH, once started. */
  setup: WorkerSetupView | null
  onTrust: () => void
  onAgain: () => void
  onStop: () => void
  /** The code, while that way is chosen. */
  code: WorkerCodeView | null
  onClose: () => void
  text?: Partial<AddWorkerText> | undefined
}

type StepState = 'done' | 'now' | 'failed' | 'later'

/** Add a worker: over SSH, as it goes; or with a code. */
export function AddWorkerDialog({
  home,
  way,
  onWay,
  ssh = true,
  address,
  onAddress,
  addressError,
  onAdd,
  setup,
  onTrust,
  onAgain,
  onStop,
  code,
  onClose,
  text,
}: AddWorkerDialogProps) {
  const t = { ...addWorkerText, ...text }
  const field = useId()
  const hint = useId()
  const going = setup !== null && setup.phase !== 'failed' && setup.phase !== 'done'
  const chosen = ssh ? way : 'code'
  const actions =
    chosen === 'code' ? (
      <Button onClick={onClose}>{t.close}</Button>
    ) : setup === null ? (
      <>
        <Button onClick={onClose}>{t.cancel}</Button>
        <Button variant="signal" type="submit" disabled={address.trim() === ''}>
          {t.add}
        </Button>
      </>
    ) : setup.phase === 'trust' ? (
      <>
        <Button onClick={onStop}>{t.stop}</Button>
        <Button variant="signal" onClick={onTrust}>
          {t.trust}
        </Button>
      </>
    ) : setup.phase === 'failed' ? (
      <>
        <Button onClick={onClose}>{t.close}</Button>
        {setup.problem?.retry !== false && (
          <Button variant="signal" onClick={onAgain}>
            {t.again}
          </Button>
        )}
      </>
    ) : (
      <Button onClick={going ? onStop : onClose}>{going ? t.stop : t.close}</Button>
    )
  return (
    <Dialog
      title={t.title(home)}
      description={setup === null ? t.note : undefined}
      onClose={onClose}
      holding={going}
      {...(chosen === 'ssh' && setup === null ? { onSubmit: onAdd } : {})}
      actions={actions}
      width={520}
    >
      <div className={s.adding}>
        {setup === null && ssh && (
          <Segmented
            label={t.title(home)}
            options={[
              { value: 'ssh', label: t.overSsh },
              { value: 'code', label: t.withCode },
            ]}
            value={chosen}
            onChange={onWay}
          />
        )}
        {chosen === 'ssh' && setup === null && (
          <div className={s.addressRow}>
            <label htmlFor={field} className={s.addressLabel}>
              {t.address}
            </label>
            <Field
              id={field}
              className={s.address}
              value={address}
              onChange={(event) => onAddress(event.target.value)}
              placeholder="build@build-box"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the one thing to type, as the dialog opens.
              autoFocus
              invalid={addressError != null}
              aria-describedby={hint}
            />
            {addressError != null ? (
              <Problem as="span" size="small" id={hint}>
                {addressError}
              </Problem>
            ) : (
              <span id={hint} className={s.addressHint}>
                {t.addressHint}
              </span>
            )}
          </div>
        )}
        {chosen === 'ssh' && setup !== null && <WorkerSteps setup={setup} home={home} t={t} />}
        {chosen === 'code' && <WorkerCode code={code} home={home} t={t} />}
      </div>
    </Dialog>
  )
}

/** Adding a worker over SSH, a step a line: what each did, the host key to trust, and where it stopped. */
function WorkerSteps({ setup, home, t }: { setup: WorkerSetupView; home: string; t: AddWorkerText }) {
  const labels = t.steps(home)
  const stateOf = (index: number): StepState =>
    index < setup.at || setup.phase === 'done' ? 'done' : index === setup.at ? (setup.phase === 'failed' ? 'failed' : 'now') : 'later'
  const detail = (index: number, state: StepState) => {
    if (index === 0 && state === 'done') return setup.name
    if (index === 1 && state === 'done') return setup.facts ?? null
    if (index === 2 && state === 'now' && setup.progress !== undefined && setup.progress.megabytes > 0) {
      const done = Math.round(setup.progress.fraction * setup.progress.megabytes)
      return setup.progress.sending ? t.sent(done, setup.progress.megabytes) : t.downloading(done, setup.progress.megabytes)
    }
    if (index === 2 && state === 'done' && setup.version !== undefined) return t.checked(setup.version)
    if (index === 3 && state === 'done') return t.enrolled(home)
    if (index === 4 && state === 'done') return t.started
    return null
  }
  return (
    <div className={s.install}>
      <ol className={s.installSteps} aria-live="polite" aria-label={t.title(home)}>
        {labels.map((label, index) => {
          const state = stateOf(index)
          const said = detail(index, state)
          return (
            <li key={label} data-state={state}>
              <span className={s.tick}>
                {state === 'done' ? (
                  <Icon name="check" size={10} />
                ) : state === 'failed' ? (
                  <Icon name="close" size={10} />
                ) : state === 'now' && setup.phase === 'trust' ? (
                  <Icon name="lock" size={10} />
                ) : state === 'now' ? (
                  <Spinner size="small" />
                ) : null}
              </span>
              <span className={s.installWords}>
                <span className={s.installLabel}>{label}</span>
                {said !== null && <span className={s.installDetail}>{said}</span>}
                {index === 2 && state === 'now' && setup.progress !== undefined && setup.progress.megabytes > 0 && (
                  <span className={s.bar}>
                    <span style={{ transform: `scaleX(${setup.progress.fraction})` }} />
                  </span>
                )}
                {state === 'now' && setup.phase === 'trust' && setup.hostKey !== undefined && (
                  <AskCard icon="lock" kicker={t.firstTime} what={t.isThisKey(setup.name)} className={s.ask}>
                    <span className={s.fingerprint}>
                      <code>{setup.hostKey.fingerprint}</code>
                      <CopyButton value={setup.hostKey.fingerprint} ghost />
                    </span>
                    <span className={s.addressHint}>{t.keyWhere}</span>
                  </AskCard>
                )}
                {state === 'failed' && setup.problem !== undefined && (
                  <span className={s.stopped}>
                    <Problem as="span" size="small">
                      {setup.problem.title}
                    </Problem>
                    {setup.problem.body !== undefined && <span className={s.addressHint}>{setup.problem.body}</span>}
                    {setup.problem.command !== undefined && (
                      <span className={s.lineToRun}>
                        <Code className={s.lineToRunText}>{setup.problem.command}</Code>
                        <CopyButton value={setup.problem.command} ghost />
                      </span>
                    )}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {setup.linger !== undefined && setup.phase !== 'failed' && (
        <div className={s.leftToDo}>
          <span className={s.addressHint}>{t.linger}</span>
          <span className={s.lineToRun}>
            <Code className={s.lineToRunText}>{setup.linger}</Code>
            <CopyButton value={setup.linger} ghost />
          </span>
        </div>
      )}
      {setup.phase === 'done' && <span className={s.waiting}>{t.waiting}</span>}
    </div>
  )
}

/** The one-time code's way: the line to run on the machine, how long it still works, and where it shows. */
function WorkerCode({ code, home, t }: { code: WorkerCodeView | null; home: string; t: AddWorkerText }) {
  if (code?.failed != null)
    return (
      <Problem as="div" size="small">
        {code.failed}
      </Problem>
    )
  return (
    <div className={s.codeWay}>
      <span className={s.addressHint}>{t.codeNote(home)}</span>
      {code?.command == null ? (
        <span className={s.making}>
          <Spinner size="small" />
          {t.making}
        </span>
      ) : (
        <span className={s.lineToRun}>
          <Code className={s.codeLine}>{code.command}</Code>
          <CopyButton value={code.command} ghost />
        </span>
      )}
      <span className={s.waiting}>
        {code?.lasts != null && <span>{t.codeLasts(code.lasts)}</span>}
        <span>{t.shows}</span>
      </span>
    </div>
  )
}
