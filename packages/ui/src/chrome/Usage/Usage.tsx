import { Dialog } from 'radix-ui'
import { useId, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Usage.module.css'
import { usageTone } from './tone'

/*
 * How much of each account's plan is left: every account of every agent,
 * grouped by the agent. Each says its name and plan, one meter per window
 * (5 hours, week, month) with the share left and when it resets, and where
 * the numbers came from and how old they are. The meter runs from calm to
 * red at the thresholds the warnings come at, and always says the share in
 * words, so colour is never the only sign.
 *
 * An account whose numbers are missing says why, plainly and in its own
 * tone, never as an empty row; the windows it still shows are the last ones
 * read, dimmed. An account on an API key has no plan window and says so,
 * calmly. A modal dialog the consumer mounts to open, like the finder:
 * Escape or a press outside closes it and gives focus back to what had it.
 * "Read again" asks every account's source anew.
 */

/** One window of an account's plan. */
export interface UsageMeterRow {
  id: string
  /** 5 hours, Week, Month, or the window's own name: Opus. */
  label: string
  /** The share of the window left, 0 to 100. */
  left: number
  /** When it resets, written for the person: 17:00, Mon 9:00 AM. Null where the source did not say. */
  resets: string | null
}

/** Why an account has no numbers, or old ones. */
export type UsageFaultKind = 'sign_in_again' | 'source_changed' | 'unreachable' | 'no_source' | 'no_data_yet' | 'cannot_classify'

/** One account of an agent. */
export interface UsageAccountRow {
  id: string
  name: string
  /** The plan as the agent names it: Pro, Max. Null where it is not known. */
  plan: string | null
  /** What the account is paid by: its plan, an API key (no plan window), or not known. */
  paidBy: 'plan' | 'key' | 'unknown'
  meters: readonly UsageMeterRow[]
  /** Where the numbers came from and how old they are: Reported by Codex · 3m ago. Null before any. */
  source: string | null
  /** Why the numbers are missing, or the last ones; the consumer writes the message. */
  fault: { kind: UsageFaultKind; message: string } | null
}

/** An agent and its accounts. */
export interface UsageGroup {
  id: string
  name: string
  accounts: readonly UsageAccountRow[]
}

export interface UsageText {
  /** The dialog's name. */
  title: string
  close: string
  /** Asks every account's source anew. */
  readAgain: string
  reading: string
  /** Said before the first read comes. */
  loading: string
  /** No agent has an account yet. */
  none: string
  /** An account paid by an API key. */
  key: string
  /** An account whose payment is not known and that has no numbers or fault. */
  unknown: string
  /** The plan, beside the account's name. */
  plan: (plan: string) => string
  /** A meter's share, in words. */
  left: (percent: number) => string
  resets: (when: string) => string
  /** Said when the source gave no reset time. */
  resetsUnknown: string
  /** A meter's name, which says whose window it is: Codex work, 5 hours. */
  meterName: (agent: string, account: string, window: string) => string
  /** The meter's spoken value. */
  meter: (left: string, resets: string) => string
  /** The head of each kind of fault. */
  fault: Record<UsageFaultKind, string>
  /** Said of the windows shown beside a fault: they are the last ones. */
  lastRead: string
  /** The accounts of one agent, named by it. */
  accounts: (agent: string) => string
}

export const usageText: UsageText = {
  title: 'Plan usage',
  close: 'Close',
  readAgain: 'Read again',
  reading: 'Reading…',
  /** Said before the first read comes. */
  loading: 'Reading usage…',
  none: 'No agent accounts yet.',
  key: 'API key – no plan window',
  unknown: 'How this account is paid is not known.',
  plan: (plan) => `${plan} plan`,
  left: (percent) => `${percent}% left`,
  resets: (when) => `Resets ${when}`,
  resetsUnknown: 'Reset time not given',
  meterName: (agent, account, window) => `${agent} ${account}, ${window}`,
  meter: (left, resets) => `${left}, ${resets}`,
  fault: {
    sign_in_again: 'Sign in again',
    source_changed: 'The usage source changed',
    unreachable: 'Can’t reach the usage source',
    no_source: 'No usage source',
    no_data_yet: 'No usage data yet',
    cannot_classify: 'Can’t tell what this account uses',
  },
  lastRead: 'Last numbers read',
  accounts: (agent) => `${agent} accounts`,
}

export interface UsageProps {
  /** Every agent with its accounts; null before they are first read, which is not the same as none. */
  groups: readonly UsageGroup[] | null
  /** Every account's source is being read again: Read again waits, and says so. */
  reading?: boolean
  /** Why the last Read again failed, in words; shown above the accounts, which stay as they were. */
  error?: string
  /** Read every account's source again. */
  onRefresh: () => void
  /** Escape, a press outside, or Close. */
  onClose: () => void
  text?: Partial<UsageText>
}

function Meter({ row, name, stale, t }: { row: UsageMeterRow; name: string; stale: boolean; t: UsageText }) {
  const left = Math.min(100, Math.max(0, Math.round(row.left)))
  const resets = row.resets === null ? t.resetsUnknown : t.resets(row.resets)
  return (
    <div className={s.meter} data-tone={usageTone(left)} data-stale={stale || undefined}>
      <span className={s.label}>{row.label}</span>
      {/* low, high and optimum span the whole, so the browser never tones it itself: the tone is ours */}
      <meter
        aria-label={name}
        aria-valuetext={t.meter(t.left(left), resets)}
        min={0}
        max={100}
        low={0}
        high={100}
        optimum={100}
        value={left}
        className={s.track}
      />
      <span className={s.left}>{t.left(left)}</span>
      <span className={s.resets}>{resets}</span>
    </div>
  )
}

function Account({ agent, account, t }: { agent: string; account: UsageAccountRow; t: UsageText }) {
  const { fault } = account
  const bare = account.meters.length === 0
  return (
    <li className={s.account}>
      <div className={s.name}>
        <span className={s.who}>{account.name}</span>
        {account.plan !== null && <span className={s.plan}>{t.plan(account.plan)}</span>}
      </div>
      {fault !== null && (
        <p className={s.fault} data-kind={fault.kind}>
          <span className={s.faultHead}>{t.fault[fault.kind]}</span> <span>{fault.message}</span>
        </p>
      )}
      {fault === null && bare && <p className={s.calm}>{account.paidBy === 'key' ? t.key : t.unknown}</p>}
      {!bare && (
        <div className={s.meters}>
          {fault !== null && <VisuallyHidden>{t.lastRead}</VisuallyHidden>}
          {account.meters.map((row) => (
            <Meter key={row.id} row={row} name={t.meterName(agent, account.name, row.label)} stale={fault !== null} t={t} />
          ))}
        </div>
      )}
      {account.source !== null && <p className={s.source}>{account.source}</p>}
    </li>
  )
}

export function Usage({ groups, reading = false, error, onRefresh, onClose, text }: UsageProps) {
  const t = { ...usageText, ...text }
  const ids = useId()
  // What had focus as it opened: there is no trigger of Radix's to give it back to.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        {/* the ch-root class carries type into the portal */}
        <Dialog.Content
          className={cx('ch-root', s.dialog)}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
          }}
        >
          <div className={s.head}>
            <Dialog.Title className={s.title}>{t.title}</Dialog.Title>
            <Button size="small" busy={reading} onClick={onRefresh}>
              {reading ? t.reading : t.readAgain}
            </Button>
            <Dialog.Close asChild>
              <Button size="small" variant="quiet">
                {t.close}
              </Button>
            </Dialog.Close>
          </div>
          <div className={s.body} aria-busy={reading}>
            {error !== undefined && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {groups === null && <p className={s.none}>{t.loading}</p>}
            {groups?.length === 0 && <p className={s.none}>{t.none}</p>}
            {groups?.map((group) => (
              <section key={group.id} className={s.group} aria-labelledby={`${ids}-${group.id}`}>
                <h3 className={s.agent} id={`${ids}-${group.id}`}>
                  {group.name}
                </h3>
                <ul className={s.accounts} aria-label={t.accounts(group.name)}>
                  {group.accounts.map((account) => (
                    <Account key={account.id} agent={group.name} account={account} t={t} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
