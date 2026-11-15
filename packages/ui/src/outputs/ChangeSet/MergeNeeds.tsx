import type { ComponentPropsWithRef, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { CheckState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Checks, skippedLast, type ChangeCheck } from '../../primitives/Checks/Checks'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ChangeSet.module.css'
import m from './MergeNeeds.module.css'

/*
 * What merging a change needs on its host, each ticked, crossed or waiting
 * (DEV-204), as a card's lines: what is crossed first, each saying what to
 * do, then what waits on someone, then what the host doesn't say, never
 * ticked; its checks always, opening to them, the required ones first and
 * the optional ones apart; and what is met, folded to one line that opens to
 * it.
 */

export type MergeNeedState = 'met' | 'unmet' | 'waiting' | 'unknown'

export type MergeNeedKind =
  | 'checks'
  | 'approvals'
  | 'code_owners'
  | 'changes_requested'
  | 'conversations'
  | 'up_to_date'
  | 'conflicts'
  | 'draft'
  | 'pushed'
  | 'signatures'
  | 'linear_history'
  | 'merge_queue'
  | 'other'

/**
 * One thing merging needs, as it stands. Its numbers and names by its kind:
 * checks, `have` of `need` required ones passed, `who` those failed or still
 * to finish, `required` their names where the host says (else every check
 * counts), `apart` the optional ones; approvals, `have` of `need`, `who`
 * approved or, waiting, who is asked; code owners, who it waits on; changes,
 * who asked for them; conversations, `have` of `need` resolved; up to date,
 * `have` commits behind; pushed, `have` commits left, and `said` where they
 * wait for something other than a push; signatures, `have` unsigned; other,
 * the host's words in `said`.
 */
export interface MergeNeed {
  kind: MergeNeedKind
  state: MergeNeedState
  have?: number
  need?: number
  who?: readonly string[]
  said?: string
  required?: readonly string[]
  apart?: { readonly passed: number; readonly failed: readonly string[]; readonly running: number }
}

/** A list of names: a, a and b, a, b and c. */
const listOf = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`

const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

export interface MergeNeedsText {
  /** The list, read out. */
  label: string
  /** Each state, read out before its line. */
  state: Record<MergeNeedState, string>
  /** What a line says, from what it is about; `host` its host's name, `target` the branch it merges into. */
  said: (need: MergeNeed, host: string, target: string) => string
  /** What to do about a crossed line, where there is something; null where there isn't. */
  todo: (need: MergeNeed, host: string) => string | null
  /** Its optional checks, apart, where any failed or still run. */
  apart: (apart: NonNullable<MergeNeed['apart']>) => string | null
  /** The met lines, folded: how many more; or, with nothing left, that the host has all it needs. */
  more: (n: number) => string
  all: (host: string) => string
  /** Its optional checks, under its required ones. */
  optional: string
}

const saidOf = (need: MergeNeed, host: string, target: string): string => {
  const { state, have = 0, need: wanted, who = [] } = need
  const unknown = (what: string) => `${what}: ${host} doesn’t say`
  switch (need.kind) {
    case 'checks': {
      const of = need.required === undefined ? 'checks' : 'required checks'
      if (state === 'unknown') return 'No checks have run yet'
      if (state === 'unmet') return who.length === 1 ? `${who[0] ?? ''} failed` : `${who.length} ${of} failed: ${who.join(', ')}`
      if (state === 'waiting') return wanted === undefined ? `Waiting on ${listOf(who)}` : `${have} of ${wanted} ${of} passed`
      if (need.required !== undefined && wanted === 0) return 'No checks required'
      return wanted === 1
        ? need.required === undefined
          ? '1 check passed'
          : 'The required check passed'
        : `${wanted ?? have} ${of} passed`
    }
    case 'approvals': {
      if (state === 'met') return who.length > 0 ? `Approved by ${listOf(who)}` : 'Approved'
      if (state === 'waiting') return `Waiting on a review from ${listOf(who)}`
      if (state === 'unknown')
        return who.length > 0 ? `Approved by ${listOf(who)}; how many it needs, ${host} doesn’t say` : unknown('Approvals')
      if (wanted === undefined) return 'Needs an approval'
      const left = Math.max(wanted - have, 1)
      return have === 0
        ? left === 1
          ? 'Needs an approval'
          : `Needs ${left} approvals`
        : left === 1
          ? 'Needs 1 more approval'
          : `Needs ${left} more approvals`
    }
    case 'code_owners':
      return state === 'met'
        ? 'Code owners’ review in'
        : state === 'waiting'
          ? `Waiting on a code owner: ${listOf(who)}`
          : state === 'unmet'
            ? 'Needs a code owner’s review'
            : unknown('Code owners’ review')
    case 'changes_requested':
      return state === 'met'
        ? 'No changes requested'
        : state === 'unknown'
          ? unknown('Changes requested')
          : who.length > 0
            ? `Changes requested by ${listOf(who)}`
            : 'Changes requested'
    case 'conversations': {
      if (state === 'met') return 'Conversations resolved'
      if (state === 'unknown') return unknown('Conversations resolved')
      const open = wanted === undefined ? null : wanted - have
      return open === null ? 'Conversations unresolved' : open === 1 ? '1 conversation unresolved' : `${open} conversations unresolved`
    }
    case 'up_to_date':
      return state === 'met'
        ? `Up to date with ${target}`
        : state === 'unknown'
          ? have > 0
            ? `${commits(have)} behind ${target}; whether it must be up to date, ${host} doesn’t say`
            : unknown(`Up to date with ${target}`)
          : have > 0
            ? `${commits(have)} behind ${target}`
            : `Behind ${target}`
    case 'conflicts':
      return state === 'met'
        ? `No conflicts with ${target}`
        : state === 'unmet'
          ? `Conflicts with ${target}`
          : `Conflicts with ${target}: not worked out yet`
    case 'draft':
      return state === 'met' ? 'Not a draft' : 'A draft'
    case 'pushed':
      // Held for Ship, said so: Ship sends them up, not a push.
      return state === 'met'
        ? 'Nothing to push'
        : need.said !== undefined
          ? need.said
          : state === 'waiting'
            ? `${commits(have)} going up`
            : have > 0
              ? `${commits(have)} not pushed`
              : 'Its branch has parted from it'
    case 'signatures':
      return state === 'met'
        ? 'Commits signed'
        : state === 'unknown'
          ? unknown('Commits signed')
          : `${have === 0 ? 'A commit' : commits(have)} not signed`
    case 'linear_history':
      return state === 'met' ? 'Merges as a squash or rebase, for a linear history' : 'Needs a linear history: no merge commits'
    case 'merge_queue':
      return state === 'waiting' ? 'In the merge queue' : 'Merges through the merge queue'
    case 'other':
      return need.said ?? (state === 'unknown' ? unknown('Something else') : `${host} holds it back for a rule Althar can’t read`)
  }
}

const todoOf = (need: MergeNeed, host: string): string | null => {
  if (need.state !== 'unmet') return null
  switch (need.kind) {
    case 'approvals':
    case 'code_owners':
      return 'Ask for a review'
    case 'up_to_date':
      return 'Update the branch'
    case 'draft':
      return 'Mark it ready'
    case 'pushed':
      return (need.have ?? 0) > 0 ? 'Push them' : null
    case 'linear_history':
    case 'other':
      return `See it on ${host}`
    default:
      return 'Ask the lead'
  }
}

export const mergeNeedsText: MergeNeedsText = {
  label: 'What merging needs',
  state: { met: 'Met', unmet: 'Missing', waiting: 'Waiting', unknown: 'Not known' },
  said: saidOf,
  todo: todoOf,
  apart: (apart) =>
    apart.failed.length > 0
      ? apart.failed.length === 1
        ? `optional ${apart.failed[0] ?? ''} failed`
        : `${apart.failed.length} optional failed`
      : apart.running > 0
        ? `${apart.running} optional running`
        : null,
  more: (n) => (n === 1 ? '1 more met' : `${n} more met`),
  all: (host) => `Everything ${host} needs is met`,
  optional: 'Optional',
}

export interface MergeNeedsProps {
  needs: readonly MergeNeed[]
  /** Its host, by name: GitHub. */
  host: string
  /** The branch it merges into: main. */
  target?: string
  /** Its checks, which its checks' line opens to; without them, the line doesn't open. */
  checks?: readonly ChangeCheck[]
  className?: string
  text?: Partial<MergeNeedsText>
}

/** Crossed first, then waiting, then not known; in the order the host's list has them within each. */
const URGENCY: Readonly<Record<MergeNeedState, number>> = { unmet: 0, waiting: 1, unknown: 2, met: 3 }

export function MergeNeeds({ needs, host, target = 'main', checks, className, text }: MergeNeedsProps) {
  const t = { ...mergeNeedsText, ...text, state: { ...mergeNeedsText.state, ...text?.state } }
  const open = needs
    .map((need, at) => ({ need, at }))
    .filter(({ need }) => need.state !== 'met' || need.kind === 'checks')
    .sort((a, b) => URGENCY[a.need.state] - URGENCY[b.need.state] || a.at - b.at)
    .map(({ need }) => need)
  const met = needs.filter((need) => need.state === 'met' && need.kind !== 'checks')
  // Keyed by kind and place: two of a kind (a host's other rules) may say the same.
  const line = (need: MergeNeed, at: number) =>
    need.kind === 'checks' && checks !== undefined && checks.length > 0 ? (
      <ChecksNeed key={need.kind} need={need} checks={checks} host={host} target={target} t={t} />
    ) : (
      <li key={`${need.kind}-${at}`}>
        <Said need={need} host={host} target={target} t={t} />
      </li>
    )
  const everything = open.every((need) => need.state === 'met')
  return (
    <ul className={cx(s.lines, m.needs, className)} aria-label={t.label}>
      {open.map(line)}
      {met.length > 0 && (
        <li>
          <Disclosure>
            <DisclosureTrigger>
              <button type="button" className={cx(s.line, s.opens, s.good)}>
                <span className={s.mark}>
                  <Icon name="check" size={12} />
                </span>
                <span className={s.said}>{everything ? t.all(host) : t.more(met.length)}</span>
                <Caret />
              </button>
            </DisclosureTrigger>
            <Fold bleed={false}>
              <ul className={m.met}>
                {met.map((need, at) => (
                  <li key={`${need.kind}-${at}`}>
                    <Said need={need} host={host} target={target} t={t} />
                  </li>
                ))}
              </ul>
            </Fold>
          </Disclosure>
        </li>
      )}
    </ul>
  )
}

/** How a line is marked: crossed, waited on (its checks running live), not known, or ticked. */
function Mark({ need }: { need: MergeNeed }) {
  switch (need.state) {
    case 'unmet':
      return <Icon name="close" size={12} />
    case 'waiting':
      return need.kind === 'checks' ? <LiveDot ping /> : <span className={m.ring} aria-hidden="true" />
    case 'unknown':
      return (
        <span className={m.unknown} aria-hidden="true">
          ?
        </span>
      )
    case 'met':
      return <Icon name="check" size={12} />
  }
}

const toneOf = (need: MergeNeed) =>
  need.state === 'unmet' ? s.bad : need.state === 'met' ? s.good : need.state === 'waiting' && need.kind === 'checks' ? s.running : m.quiet

type Text = MergeNeedsText

/**
 * One line: its mark, what it says, and, crossed, what to do about it. Where it `opens`, a button, taking what a trigger
 * around it gives it (its press, its state, its ref).
 */
function Said({
  need,
  host,
  target,
  t,
  opens,
  ...button
}: { need: MergeNeed; host: string; target: string; t: Text; opens?: ReactNode } & Omit<ComponentPropsWithRef<'button'>, 'children'>) {
  const said = t.said(need, host, target)
  const todo = t.todo(need, host)
  const apart = need.apart === undefined ? null : t.apart(need.apart)
  const words = (
    <>
      <span className={s.mark}>
        <Mark need={need} />
      </span>
      <span className={m.words}>
        <VisuallyHidden>{t.state[need.state]}: </VisuallyHidden>
        <span className={m.said}>{said}</span>
        {apart !== null && <span className={m.todo}>{apart}</span>}
        {todo !== null && <span className={m.todo}>{todo}</span>}
      </span>
    </>
  )
  return opens === undefined ? (
    <p className={cx(s.line, m.line, toneOf(need))}>{words}</p>
  ) : (
    <button type="button" {...button} className={cx(s.line, s.opens, m.line, toneOf(need), button.className)}>
      {words}
      {opens}
    </button>
  )
}

/** Its checks' line, opening to them: the required ones first, the optional ones apart under them. */
function ChecksNeed({
  need,
  checks,
  host,
  target,
  t,
}: {
  need: MergeNeed
  checks: readonly ChangeCheck[]
  host: string
  target: string
  t: Text
}) {
  const required = need.required
  const counted = required === undefined ? checks : checks.filter((check) => required.includes(check.name))
  // A required check that hasn't started is listed all the same, as one to come.
  const missing = (required ?? [])
    .filter((name) => !checks.some((check) => check.name === name))
    .map((name): ChangeCheck => ({ id: `missing:${name}`, name, state: CheckState.Queued }))
  const optional = required === undefined ? [] : checks.filter((check) => !required.includes(check.name))
  return (
    <li>
      <Disclosure>
        <DisclosureTrigger>
          <Said need={need} host={host} target={target} t={t} opens={<Caret />} />
        </DisclosureTrigger>
        <Fold bleed={false}>
          <div className={s.list}>
            {counted.length + missing.length > 0 && <Checks checks={skippedLast([...counted, ...missing])} />}
            {optional.length > 0 && (
              <>
                <p className={m.heading}>{t.optional}</p>
                <Checks checks={skippedLast(optional)} />
              </>
            )}
          </div>
        </Fold>
      </Disclosure>
    </li>
  )
}
