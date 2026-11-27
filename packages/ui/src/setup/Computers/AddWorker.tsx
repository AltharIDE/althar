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

/** The steps of adding a worker over SSH, in order: the last, a test run, so what would fail a task fails here. */
export const WORKER_STEP_COUNT = 6

/** Where adding a worker over SSH stands, as the window words it. */
export interface WorkerSetupView {
  /** The machine, as the person gave it. */
  name: string
  phase: 'running' | 'trust' | 'enroll' | 'failed' | 'done'
  /** The step it is at, 0 to 5; 6 once done. Done at 5: added, and its check found what stops a task there. */
  at: number
  /** What step 1 found: Linux · arm64 · 62 GB free. */
  facts?: string | undefined
  /** The release, while it comes: how far, and its size. */
  progress?: { fraction: number; megabytes: number; sending: boolean } | undefined
  version?: string | undefined
  /** Its SSH host key, seen the first time: its fingerprint, and its type (ED25519, ECDSA, RSA) to read it by there. */
  hostKey?: { fingerprint: string; type?: string | undefined } | undefined
  /** Where it stopped: what happened, what to do, and whether trying again can help. */
  problem?: { title: string; body?: string | undefined; command?: string | undefined; retry: boolean } | undefined
  /** What its check found, in a line: Sandbox starts · Claude Code starts. */
  checked?: string | undefined
  /** Its check runs again. */
  checking?: boolean | undefined
  /** Allowing the sandbox is one press here: sudo over SSH, where the login may. */
  canAllow?: boolean | undefined
}

/** A one-time code for a machine without SSH, and the line that takes it there. A code that runs out is made again by itself. */
export interface WorkerCodeView {
  /** The line to run on the machine; null while it is being made. */
  command: string | null
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
  keyWhere: { before: string; command: (type: string | undefined) => string; after: string }
  trust: string
  again: string
  stop: string
  waiting: string
  codeNote: (home: string) => string
  making: string
  checkAgain: string
  checking: string
  allow: string
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
  steps: (home) => [
    'Reach the machine',
    'Look it over',
    'Install the worker',
    `Enroll it with ${home}`,
    'Start its service',
    'Check it can run a task',
  ],
  sent: (done, all) => `Sending from this computer · ${done} of ${all} MB`,
  downloading: (done, all) => `Downloading · ${done} of ${all} MB`,
  checked: (version) => `${version}, signature checked`,
  enrolled: (home) => `Signed by ${home}`,
  started: 'Starts with the machine, updates itself',
  firstTime: 'First time on this machine',
  isThisKey: (name) => `Is this ${name}’s key?`,
  keyWhere: {
    before: 'On the machine, ',
    // The file of the type the machine offered: ed25519 where it has one, else ECDSA or RSA.
    command: (type) => `ssh-keygen -lf /etc/ssh/ssh_host_${type === 'ECDSA' ? 'ecdsa' : type === 'RSA' ? 'rsa' : 'ed25519'}_key.pub`,
    after: ' prints it.',
  },
  trust: 'Trust and go on',
  again: 'Try again',
  stop: 'Stop',
  waiting: 'Waiting for it to connect…',
  codeNote: (home) => `Run this on the machine. It installs the worker and enrolls it with ${home}. The code works once.`,
  making: 'Making a code…',
  checkAgain: 'Check again',
  checking: 'Checking…',
  allow: 'Allow with sudo',
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
  /** Its check again, once added; and allowing its sandbox where only root may, with sudo over SSH. */
  onCheckWorker?: (() => void) | undefined
  onAllow?: (() => void) | undefined
  /** The code, while that way is chosen. */
  code: WorkerCodeView | null
  /** No release can add a worker yet: said in place of both ways, until a setup has started. */
  unavailable?: { title: string; body?: string | undefined } | null | undefined
  /** Asks again whether one can, or for the code where it couldn't be given. */
  onCheck?: (() => void) | undefined
  /** Check again is pressed and not yet answered. */
  checking?: boolean | undefined
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
  onCheckWorker,
  onAllow,
  code,
  unavailable,
  onCheck,
  checking = false,
  onClose,
  text,
}: AddWorkerDialogProps) {
  const t = { ...addWorkerText, ...text }
  const field = useId()
  const hint = useId()
  const going = setup !== null && setup.phase !== 'failed' && setup.phase !== 'done'
  // Added, and its check found what stops a task there: what to do about it.
  const unready = setup !== null && setup.phase === 'done' && setup.at < WORKER_STEP_COUNT
  const chosen = ssh ? way : 'code'
  const blocked = setup === null && unavailable != null
  const checkAgain = onCheck !== undefined && (
    <Button variant="signal" onClick={onCheck} disabled={checking}>
      {checking ? t.checking : t.checkAgain}
    </Button>
  )
  const actions = blocked ? (
    <>
      <Button onClick={onClose}>{t.close}</Button>
      {checkAgain}
    </>
  ) : chosen === 'code' && code?.failed != null ? (
    <>
      <Button onClick={onClose}>{t.close}</Button>
      {checkAgain}
    </>
  ) : chosen === 'code' ? (
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
  ) : unready ? (
    <>
      <Button onClick={onClose}>{t.close}</Button>
      {onCheckWorker !== undefined && (
        <Button variant={setup.canAllow === true ? 'default' : 'signal'} onClick={onCheckWorker} disabled={setup.checking === true}>
          {setup.checking === true ? t.checking : t.checkAgain}
        </Button>
      )}
      {setup.canAllow === true && onAllow !== undefined && (
        <Button variant="signal" onClick={onAllow} disabled={setup.checking === true}>
          {t.allow}
        </Button>
      )}
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
      {...(chosen === 'ssh' && setup === null && !blocked ? { onSubmit: onAdd } : {})}
      actions={actions}
      width={520}
    >
      <div className={s.adding}>
        {blocked && (
          <span className={s.stopped} aria-live="polite">
            <Problem as="span" size="small">
              {unavailable.title}
            </Problem>
            {unavailable.body !== undefined && <span className={s.addressHint}>{unavailable.body}</span>}
          </span>
        )}
        {setup === null && ssh && !blocked && (
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
        {chosen === 'ssh' && setup === null && !blocked && (
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
        {chosen === 'code' && !blocked && <WorkerCode code={code} home={home} t={t} />}
      </div>
    </Dialog>
  )
}

/** Adding a worker over SSH, a step a line: what each did, the host key to trust, and where it stopped. */
function WorkerSteps({ setup, home, t }: { setup: WorkerSetupView; home: string; t: AddWorkerText }) {
  const labels = t.steps(home)
  const stateOf = (index: number): StepState =>
    index < setup.at || (setup.phase === 'done' && index > setup.at)
      ? 'done'
      : index === setup.at
        ? setup.phase === 'failed' || (setup.phase === 'done' && setup.checking !== true)
          ? 'failed'
          : 'now'
        : 'later'
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
    if (index === 5 && state === 'done') return setup.checked ?? null
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
                    <span className={s.addressHint}>
                      {t.keyWhere.before}
                      <Code>{t.keyWhere.command(setup.hostKey.type)}</Code>
                      {t.keyWhere.after}
                    </span>
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
      {setup.phase === 'done' && setup.at >= WORKER_STEP_COUNT && <span className={s.waiting}>{t.waiting}</span>}
    </div>
  )
}

/** The one-time code's way: the line to run on the machine. */
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
    </div>
  )
}
