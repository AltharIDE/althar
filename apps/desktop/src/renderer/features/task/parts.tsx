import { useState } from 'react'

import type { BoardTask, ChangeSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { Button, Field, type PartKind, PartLines, PartShots, Segmented, type TaskPartModel } from '@althar/ui'

import { outcomeOf } from '../../shared/outcome'
import { productBrand } from '../../shared/products'
import s from './parts.module.css'
import { startedPart, type StartedEntry, type StartedReading } from './Started'

/*
 * A task's parts, as its bar shows them (ADR-097, the 6 November direction
 * C): its worktree, its pull requests, a review it drafted, its issue, what
 * it runs, and what it made. Each acts through what the window can already
 * do: Merge accepts, Post it posts the draft, a failing check asks the lead
 * to fix it, Remove takes the folder. What a task takes on comes from Add:
 * a pull request, opened or attached, and what only its lead can take on
 * (a worktree, a review, an issue, a page), asked of it in the person's words.
 */

export const partsText = {
  worktree: 'Worktree',
  local: 'Local',
  /** Moving a running task between a worktree and Local (a task is a conversation plus parts). */
  toLocal: 'Move to Local',
  toWorktree: 'Move to a worktree',
  switchIt: 'Switch it',
  stayInWorktree: 'Stay in the worktree',
  callOff: 'Call it off',
  /** A helper its lead started, at work on one of its changes (ADR-087). */
  helper: (name: string) => `Helper · ${name}`,
  helperOn: (change: string | null, model: string) => `${change === null ? 'On the task’s change' : `On ${change}`}, ${model}`,
  stopHelper: 'Stop',
  /** The branch a running task works toward, changed (a task is a conversation plus parts). */
  towardField: 'Another branch to work toward',
  towardIt: 'Work toward it',
  towardNote: 'Nothing pushed, its branch moves onto it; pushed, its commits go to a new pull request into it.',
  files: (n: number) => (n === 0 ? 'No changes' : `${n} ${n === 1 ? 'file' : 'files'} changed`),
  branch: 'Branch',
  where: 'Where',
  from: 'From',
  more: (n: number) => `${n} more`,
  seeChanges: 'See the changes',
  openIn: (editor: string) => `Open in ${editor}`,
  remove: 'Remove',
  uncommitted: (n: number) => `${n} ${n === 1 ? 'file isn’t' : 'files aren’t'} committed. They’d be lost.`,
  removeAll: 'Its folder goes. Its branch stays.',
  keep: 'Keep it',
  checks: 'Checks',
  title: 'Title',
  into: 'Into',
  checksSaid: (checks: NonNullable<ChangeSummary['checks']>) =>
    checks.outcome === 'none'
      ? 'None'
      : checks.failed > 0
        ? `${checks.passed} pass, ${checks.failed} ${checks.failed === 1 ? 'fails' : 'fail'}`
        : checks.running > 0
          ? `${checks.running} running`
          : `${checks.passed} pass`,
  stands: (change: ChangeSummary) =>
    change.state === 'merged'
      ? 'Merged'
      : change.state === 'closed'
        ? 'Closed'
        : `${change.draft ? 'Draft' : 'Open'}${change.checks === null || change.checks.outcome === 'none' ? '' : change.checks.outcome === 'failed' ? ` · ${change.checks.failed} ${change.checks.failed === 1 ? 'check fails' : 'checks fail'}` : change.checks.outcome === 'running' ? ' · checks running' : ' · checks pass'}`,
  merge: 'Merge',
  /** One of several changes, in its own row: where it stands without a pull request yet. */
  noPullRequest: 'No pull request yet',
  waitingForShip: 'Commits waiting for Ship',
  stackedOn: 'Stacked on',
  helperOnIt: 'Helper',
  ship: 'Ship',
  /** A change that waits for another of the task's to merge, without building on its code. */
  waitsFor: (name: string) => `Waits for ${name} to merge`,
  /** Merge on a change stacked on another's open pull request: the one below first. */
  mergeThrough: (below: string, short: string) => `Merge ${below}, then ${short}`,
  onHost: (host: string) => `On ${host}`,
  seeCheck: 'See the check',
  fixIt: 'Ask the lead to fix it',
  fixAsk: (names: ReadonlyArray<string>, short: string) =>
    `${names.join(', ')} ${names.length === 1 ? 'fails' : 'fail'} on ${short}. Fix it.`,
  draft: 'Review draft',
  findings: (n: number) => `${n} ${n === 1 ? 'finding' : 'findings'}, not posted`,
  postIt: 'Post it',
  postOn: (short: string) => `Post it on ${short}`,
  issueStatus: 'Status',
  inTracker: (tracker: string) => `In ${tracker}`,
  running: 'Running',
  open: 'Open',
  stop: 'Stop',
  answersAt: 'Address',
  shots: (n: number) => `${n} ${n === 1 ? 'screenshot' : 'screenshots'}`,
  inOutputs: 'See them in Outputs',
  add: {
    pr: { name: 'A pull request', about: 'Opened from its branch, or one that exists' },
    worktree: { name: 'A worktree', about: 'A checkout of its own, to change code in' },
    review: { name: 'A review', about: 'Of any pull request, by another model' },
    issue: { name: 'An issue', about: 'For its lead to read' },
    browser: { name: 'A browser', about: 'A page its lead can see and click' },
    access: { name: 'Access', about: 'Something that asks, given for this task' },
  },
  openOne: 'Open one',
  attachOne: 'One that exists',
  openIt: 'Open it',
  addIt: 'Add',
  draftNote: (branch: string) => `From ${branch}, as a draft. The lead writes its description.`,
  prField: 'Its link, or its number',
  makeChange: 'Its lead makes it a change, with a worktree and a branch of its own.',
  makeChangeAsk: 'Make this a change: a worktree and a branch of its own, reviewed, ending in a pull request.',
  reviewField: 'The pull request: its link, or its number',
  reviewAsk: (pr: string) => `Review ${pr} and draft what you find; don't post it.`,
  issueField: 'Its key or link',
  issueAsk: (issue: string) => `Read ${issue}: it is part of this task.`,
  pageField: 'Its address',
  pageAsk: (url: string) => `Open ${url} in the browser and keep it open while you work.`,
  accessNote: 'With everything allowed, only what can’t be undone asks. Ask for one in the conversation when you want it to go ahead.',
  ask: 'Ask the lead',
}

export interface PartsActions {
  /** The tasks its lead started, with how the board has them now: a part of its own, listing each as the chip its thread has. */
  readonly started?: { readonly tasks: ReadonlyArray<StartedEntry>; readonly reading: StartedReading }
  readonly seeChanges: () => void
  /** The key that shows the changes too: ⌘D. */
  readonly changesKey?: string
  readonly openInEditor?: { readonly name: string; readonly open: () => void }
  readonly removeFolder?: () => void
  readonly merge: (change: ChangeSummary) => void
  readonly postReview: (draftId: string) => void
  readonly stopLaunch: (id: string) => void
  readonly openUrl: (url: string) => void
  readonly toOutputs: () => void
  readonly askLead: (words: string) => void
  readonly openChange?: () => void
  readonly attach?: (pullRequest: string) => void
  /** Moves the running task between a worktree and Local; with what it asked about the person's checkout, Switch it. */
  readonly move?: (to: 'worktree' | 'checkout', consent?: { readonly branch: string | null; readonly head: string }) => void
  /** Calls off a move that waits. */
  readonly dropMove?: () => void
  /** Points the running task at another branch to work toward. */
  readonly workToward?: (branch: string) => void
  /** Stops a helper its lead started. */
  readonly stopHelper?: (helper: string) => void
  /** Ships one of its several changes, by name, with what waits beneath it. */
  readonly shipChange?: (change: string) => void
}

/** The review drafts in the thread still waiting to be posted: the latest of each. */
/** Merge, or, on a change stacked on another whose pull request is open, the stack through it: the one below first. */
const mergeLabel = (change: { readonly short: string; readonly change?: { readonly below?: string } | undefined }) =>
  change.change?.below === undefined ? partsText.merge : partsText.mergeThrough(change.change.below, change.short)

const draftsIn = (items: ReadonlyArray<ThreadItem>) =>
  items.flatMap((item) => (item.kind === 'review_draft' && item.content.state === 'pending' ? [item.content] : []))

const SHOWN = 5

/** The task's parts, from what the window knows of it. */
export const partsOf = (snapshot: ThreadSnapshot, act: PartsActions): ReadonlyArray<TaskPartModel> => {
  const { task } = snapshot
  const t = partsText
  const host = snapshot.host?.name ?? 'the host'
  const parts: Array<TaskPartModel> = []
  if (task.worktree !== null) {
    const uncommitted = task.files.filter((file) => file.uncommitted).length
    const { move, dropMove } = act
    const moving = task.moving
    const moves =
      move === undefined || dropMove === undefined
        ? []
        : moving === undefined
          ? [
              {
                label: task.local === true ? t.toWorktree : t.toLocal,
                onClick: () => move(task.local === true ? 'worktree' : 'checkout'),
                variant: 'quiet' as const,
              },
            ]
          : moving.seen === undefined
            ? [{ label: t.callOff, onClick: dropMove, variant: 'quiet' as const }]
            : [
                { label: t.switchIt, onClick: () => move(moving.to, moving.seen), variant: 'signal' as const },
                { label: t.stayInWorktree, onClick: dropMove, variant: 'quiet' as const },
              ]
    parts.push({
      id: 'worktree',
      icon: 'folder',
      name: task.local === true ? t.local : t.worktree,
      // A move that waits says why, in place of its files; one that asks waits on the person.
      detail: moving?.why ?? t.files(task.files.length),
      ...(moving?.seen === undefined || move === undefined
        ? {}
        : { tone: 'you' as const, act: { label: t.switchIt, onClick: () => move(moving.to, moving.seen) } }),
      facts: [
        ...(task.branch === null ? [] : [[t.branch, <code key="b">{task.branch}</code>] as const]),
        ...(task.toward === undefined ? [] : [[t.into, <code key="t">{task.toward}</code>] as const]),
        [t.where, <code key="w">{task.worktree}</code>],
      ],
      ...(task.files.length === 0 && act.workToward === undefined
        ? {}
        : {
            body: (
              <>
                {task.files.length > 0 && (
                  <PartLines
                    lines={[
                      ...task.files.slice(0, SHOWN).map((file) => [file.path, file.binary ? '' : `+${file.add} −${file.del}`] as const),
                      ...(task.files.length > SHOWN ? [[t.more(task.files.length - SHOWN), ''] as const] : []),
                    ]}
                  />
                )}
                {act.workToward !== undefined && (
                  <OneField label={t.towardField} button={t.towardIt} note={t.towardNote} onGo={act.workToward} done={() => undefined} />
                )}
              </>
            ),
          }),
      actions: [
        ...(task.files.length === 0
          ? []
          : [{ label: t.seeChanges, onClick: act.seeChanges, ...(act.changesKey === undefined ? {} : { kbd: act.changesKey }) }]),
        ...moves,
        ...(act.openInEditor === undefined
          ? []
          : [
              {
                label: t.openIn(act.openInEditor.name),
                onClick: act.openInEditor.open,
                variant: 'quiet' as const,
                icon: 'external' as const,
              },
            ]),
        ...(act.removeFolder === undefined
          ? []
          : [
              {
                label: t.remove,
                onClick: act.removeFolder,
                variant: 'quiet' as const,
                end: true,
                confirm: { says: uncommitted > 0 ? t.uncommitted(uncommitted) : t.removeAll, keep: t.keep, go: t.remove },
              },
            ]),
      ],
    })
  }
  // Its lead's helpers at work, each on one of its changes, with Stop (ADR-087).
  for (const helper of task.helpers ?? []) {
    const { stopHelper } = act
    parts.push({
      id: `helper:${helper.id}`,
      icon: 'agents',
      name: t.helper(helper.name),
      detail: t.helperOn(helper.change, helper.model),
      // At work for the task, beside what its lead left running; Stop in its row.
      tone: 'live',
      facts: [],
      actions: stopHelper === undefined ? [] : [{ label: t.stopHelper, onClick: () => stopHelper(helper.id), variant: 'quiet' as const }],
    })
  }
  // Several changes: a row for each, named; one with a pull request is that pull request's row, with its own Ship where
  // commits wait on it.
  const lines = task.lines ?? []
  const { shipChange } = act
  const shipOf = (line: (typeof lines)[number]) =>
    line.waiting && shipChange !== undefined ? [{ label: t.ship, onClick: () => shipChange(line.name), variant: 'quiet' as const }] : []
  const lineFacts = (line: (typeof lines)[number]) => [
    [t.branch, <code key="b">{line.branch}</code>] as const,
    ...(line.stackedOn === null ? [] : [[t.stackedOn, line.stackedOn] as const]),
    ...(line.helper === null ? [] : [[t.helperOnIt, line.helper] as const]),
  ]
  for (const line of lines) {
    if (line.url !== null && task.changes.some((change) => change.url === line.url)) continue
    const standing = line.waitsFor === null ? t.noPullRequest : t.waitsFor(line.waitsFor)
    parts.push({
      id: `change:${line.id}`,
      icon: 'branch',
      name: line.name,
      detail: line.waiting ? `${standing} · ${t.waitingForShip}` : standing,
      ...(line.helper === null ? {} : { tone: 'live' as const }),
      facts: lineFacts(line),
      actions: shipOf(line),
    })
  }
  for (const change of task.changes) {
    const failing = change.state === 'open' && change.checks?.outcome === 'failed'
    const ready = change.state === 'open' && !change.draft && change.checks?.outcome === 'passed' && change.queued !== true
    const line = lines.find((one) => one.url === change.url)
    const standing = change.change?.waitsFor === undefined ? t.stands(change) : t.waitsFor(change.change.waitsFor)
    parts.push({
      id: `pr:${change.url}`,
      icon: 'pr',
      // One of several changes: by its name, its pull request's number in where it stands.
      name: line === undefined ? change.short : line.name,
      detail: line === undefined ? standing : `${change.short} · ${standing}${line.waiting ? ` · ${t.waitingForShip}` : ''}`,
      ...(failing
        ? { tone: 'bad' as const, act: { label: t.seeCheck } }
        : ready
          ? { tone: 'you' as const, act: { label: mergeLabel(change), onClick: () => act.merge(change) } }
          : {}),
      facts: [
        [t.title, change.title],
        ...(line === undefined ? [] : lineFacts(line)),
        ...(change.checks === null ? [] : [[t.checks, t.checksSaid(change.checks)] as const]),
        ...(change.target === undefined ? [] : [[t.into, <code key="i">{change.target}</code>] as const]),
      ],
      ...(failing && change.checks !== null
        ? {
            body: (
              <PartLines
                log
                lines={change.checks.list
                  .filter((check) => check.state === 'failed')
                  .map((check) => [`✗ ${check.name}${check.summary === null ? '' : `\n  ${check.summary}`}`, ''] as const)}
              />
            ),
          }
        : {}),
      actions: [
        ...(ready ? [{ label: mergeLabel(change), onClick: () => act.merge(change), variant: 'signal' as const }] : []),
        ...(line === undefined ? [] : shipOf(line)),
        ...(failing && change.checks !== null
          ? [{ label: t.fixIt, onClick: () => act.askLead(t.fixAsk(change.checks?.failing ?? [], change.short)) }]
          : []),
        { label: t.onHost(host), onClick: () => act.openUrl(change.url), variant: 'quiet' as const, icon: 'external' as const },
      ],
    })
  }
  for (const draft of draftsIn(snapshot.items)) {
    const short = `#${draft.number}`
    parts.push({
      id: `draft:${draft.draftId}`,
      icon: 'answer',
      name: t.draft,
      detail: t.findings(draft.comments.length),
      tone: 'you',
      act: { label: t.postIt, onClick: () => act.postReview(draft.draftId) },
      body: (
        <PartLines
          lines={draft.comments.slice(0, SHOWN).map((comment, at) => [`${at + 1}. ${comment.body.split('\n')[0] ?? ''}`, ''] as const)}
        />
      ),
      actions: [
        { label: t.postOn(short), onClick: () => act.postReview(draft.draftId), variant: 'signal' },
        { label: t.onHost(host), onClick: () => act.openUrl(draft.url), variant: 'quiet', icon: 'external' },
      ],
    })
  }
  if (task.issue !== null) {
    const issue = task.issue
    parts.push({
      id: 'issue',
      icon: productBrand(issue.product),
      name: issue.key,
      detail: issue.title,
      facts: [
        [t.title, issue.title],
        ...(issue.status === null || issue.status === undefined ? [] : [[t.issueStatus, issue.status.name] as const]),
      ],
      actions: [
        {
          label: t.inTracker(issue.product === 'linear' ? 'Linear' : host),
          onClick: () => act.openUrl(issue.url),
          variant: 'quiet',
          icon: 'external',
        },
      ],
    })
  }
  for (const launch of task.launches.filter((one) => one.ended === null)) {
    const address = launch.url
    parts.push({
      id: `run:${launch.id}`,
      icon: address === null ? 'play' : 'globe',
      name: launch.name ?? (address === null ? (launch.label ?? launch.command) : address.replace(/^https?:\/\//, '').replace(/\/$/, '')),
      detail: t.running,
      tone: 'live',
      facts: address === null ? [] : [[t.answersAt, <code key="a">{address}</code>]],
      actions: [
        ...(address === null ? [] : [{ label: t.open, onClick: () => act.openUrl(address), icon: 'external' as const }]),
        { label: t.stop, onClick: () => act.stopLaunch(launch.id), variant: 'quiet' as const, end: true },
      ],
    })
  }
  if (act.started !== undefined && act.started.tasks.length > 0) parts.push(startedPart(act.started.tasks, act.started.reading))
  const shots = outcomeOf(snapshot).shots
  if (shots.length > 0)
    parts.push({
      id: 'shots',
      icon: 'image',
      name: t.shots(shots.length),
      detail: shots[0]?.caption ?? '',
      body: (
        <PartShots
          shots={shots.flatMap((shot) =>
            shot.src === undefined ? [] : [{ id: shot.id, src: shot.thumb ?? shot.src, label: shot.caption }],
          )}
        />
      ),
      actions: [{ label: t.inOutputs, onClick: act.toOutputs }],
    })
  return parts
}

/** A short form: one field and its button, which asks or does at once and goes back to the list. */
function OneField({
  label,
  button,
  note,
  onGo,
  done,
}: {
  label: string
  button: string
  note?: string
  onGo: (value: string) => void
  done: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className={s.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim() === '') return
        onGo(value.trim())
        done()
      }}
    >
      <Field aria-label={label} placeholder={label} value={value} onChange={(event) => setValue(event.target.value)} />
      {note !== undefined && <p className={s.note}>{note}</p>}
      <div>
        <Button size="small" variant="signal" type="submit">
          {button}
        </Button>
      </div>
    </form>
  )
}

function PullRequestForm({ branch, act, done }: { branch: string | null; act: PartsActions; done: () => void }) {
  const t = partsText
  const [how, setHow] = useState<'open' | 'attach'>(act.openChange === undefined ? 'attach' : 'open')
  return (
    <div className={s.form}>
      {act.openChange !== undefined && act.attach !== undefined && (
        <Segmented<'open' | 'attach'>
          label={t.add.pr.name}
          value={how}
          onChange={setHow}
          options={[
            { value: 'open', label: t.openOne },
            { value: 'attach', label: t.attachOne },
          ]}
        />
      )}
      {how === 'open' && act.openChange !== undefined ? (
        <>
          <p className={s.note}>{t.draftNote(branch ?? 'its branch')}</p>
          <div>
            <Button
              size="small"
              variant="signal"
              onClick={() => {
                act.openChange?.()
                done()
              }}
            >
              {t.openIt}
            </Button>
          </div>
        </>
      ) : (
        <OneField label={t.prField} button={t.addIt} onGo={(value) => act.attach?.(value)} done={done} />
      )}
    </div>
  )
}

/** What a task can take on from Add, each with its form; one that can't be taken on now has none, and isn't offered. */
export const kindsOf = (snapshot: ThreadSnapshot, act: PartsActions): ReadonlyArray<PartKind> => {
  const t = partsText
  const { task } = snapshot
  const working = task.phase !== 'settled'
  const ask = (words: string, done: () => void) => {
    act.askLead(words)
    done()
  }
  return [
    {
      kind: 'pr',
      icon: 'pr',
      ...t.add.pr,
      ...(working && task.worktree !== null && (act.openChange !== undefined || act.attach !== undefined)
        ? { form: (done: () => void) => <PullRequestForm branch={task.branch} act={act} done={done} /> }
        : {}),
    },
    {
      kind: 'worktree',
      icon: 'folder',
      ...t.add.worktree,
      // A chat has none: its lead makes it a change, as make-it-a-change did; a task with one has its own already.
      ...(working && task.worktree === null
        ? {
            form: (done: () => void) => (
              <div className={s.form}>
                <p className={s.note}>{t.makeChange}</p>
                <div>
                  <Button size="small" variant="signal" onClick={() => ask(t.makeChangeAsk, done)}>
                    {t.ask}
                  </Button>
                </div>
              </div>
            ),
          }
        : {}),
    },
    {
      kind: 'review',
      icon: 'answer',
      ...t.add.review,
      ...(working
        ? {
            form: (done: () => void) => (
              <OneField label={t.reviewField} button={t.ask} onGo={(pr) => act.askLead(t.reviewAsk(pr))} done={done} />
            ),
          }
        : {}),
    },
    {
      kind: 'issue',
      icon: 'list',
      ...t.add.issue,
      ...(working
        ? {
            form: (done: () => void) => (
              <OneField label={t.issueField} button={t.ask} onGo={(issue) => act.askLead(t.issueAsk(issue))} done={done} />
            ),
          }
        : {}),
    },
    {
      kind: 'browser',
      icon: 'globe',
      ...t.add.browser,
      ...(working
        ? {
            form: (done: () => void) => (
              <OneField label={t.pageField} button={t.ask} onGo={(url) => act.askLead(t.pageAsk(url))} done={done} />
            ),
          }
        : {}),
    },
    {
      kind: 'access',
      icon: 'lock',
      ...t.add.access,
      ...(working ? { form: () => <p className={s.note}>{t.accessNote}</p> } : {}),
    },
  ]
}
