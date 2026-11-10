import { useState } from 'react'

import type { ChangeSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { Button, Field, type PartKind, PartLines, PartShots, Segmented, type TaskPartModel } from '@althar/ui'

import { outcomeOf } from '../../shared/outcome'
import { productBrand } from '../../shared/products'
import s from './parts.module.css'

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
    parts.push({
      id: 'worktree',
      icon: 'folder',
      name: t.worktree,
      detail: t.files(task.files.length),
      facts: [
        ...(task.branch === null ? [] : [[t.branch, <code key="b">{task.branch}</code>] as const]),
        [t.where, <code key="w">{task.worktree}</code>],
      ],
      ...(task.files.length === 0
        ? {}
        : {
            body: (
              <PartLines
                lines={[
                  ...task.files.slice(0, SHOWN).map((file) => [file.path, file.binary ? '' : `+${file.add} −${file.del}`] as const),
                  ...(task.files.length > SHOWN ? [[t.more(task.files.length - SHOWN), ''] as const] : []),
                ]}
              />
            ),
          }),
      actions: [
        ...(task.files.length === 0
          ? []
          : [{ label: t.seeChanges, onClick: act.seeChanges, ...(act.changesKey === undefined ? {} : { kbd: act.changesKey }) }]),
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
  for (const change of task.changes) {
    const failing = change.state === 'open' && change.checks?.outcome === 'failed'
    const ready = change.state === 'open' && !change.draft && change.checks?.outcome === 'passed' && change.queued !== true
    parts.push({
      id: `pr:${change.url}`,
      icon: 'pr',
      name: change.short,
      detail: t.stands(change),
      ...(failing
        ? { tone: 'bad' as const, act: { label: t.seeCheck } }
        : ready
          ? { tone: 'you' as const, act: { label: mergeLabel(change), onClick: () => act.merge(change) } }
          : {}),
      facts: [
        [t.title, change.title],
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
