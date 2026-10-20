import type { ChangeSummary, ChangedFile, TaskRepositoryMerged, ThreadSnapshot } from '@althar/contracts'
import { doing, type Doing } from './actions'
import { Button, ChangeSet, ChangeState, CheckState, type ChangeReview, Diverged, modKey, type PullRequest, WhatItMade } from '@althar/ui'
import type { ReactNode } from 'react'

import { type NameModel, useModelNames } from '../../shared/modelNames'
import { checkOf } from '../../shared/checks'
import { hasOutcome, outcomeOf } from '../../shared/outcome'
import { mergeHereLabel } from '../../shared/mergeHere'
import { productBrand, productName } from '../../shared/products'
import s from './Task.module.css'
import { device } from '../../shared/device'

/*
 * A task's outputs, as wide as the window: what it made on the left, what
 * it changed on the right, held in view as the left scrolls. What it made:
 * what it is, in the words its pull request says it, its pictures as it is
 * now, and what its lead couldn't check before what it did. What it changed,
 * for deciding on it: its pull requests, merged on their host when it is
 * accepted, up to the heads shown, and its repositories whose work ended on
 * its branch, which merge here. Each card says where it stands and holds the
 * one thing to press now: accept it, push what the lead committed since,
 * mark a draft ready, open a pull request. Asking for changes is a word to
 * the lead in the conversation. A branch its pull request won't take a plain
 * push of says why, and offers what puts it right. Before it is ready, the
 * same card shows what it has changed so far. A task that went back to work
 * after its pull request merged or closed shows its latest pull request, the
 * earlier ones under it, and offers a new one for the commits that are in
 * none yet (ADR-034).
 */

export const text = {
  /** Over what it is: a change, or what another task made. */
  story: (change: boolean) => (change ? 'What changed' : 'What it made'),
  sofar: 'Its branch so far',
  /** Pushed without a connection: what connecting would add, in the host's name. */
  connectAfterPush: (host: string) =>
    `Connected to ${host}, Althar would open the pull request itself, bring its checks and reviews back to the lead, and merge it there when you accept it.`,
  connect: (host: string) => `Connect ${host}`,
  closed: (change: ChangeSummary, host: string) => `${change.short} ${change.prefix}${change.number} was closed on ${host}.`,
  accept: (n: number) => (n > 2 ? `Accept and merge all ${n}` : n === 2 ? 'Accept and merge both' : 'Accept and merge'),
  markReady: 'Mark ready for review',
  markReadyIn: (repository: string) => `Mark ${repository} ready for review`,
  openChange: 'Open a pull request',
  openNewChange: 'Open a new pull request',
  /** One of the task's earlier pull requests, before its latest: merged or closed. In a task of several repositories, by its own. */
  earlier: (change: ChangeSummary, host: string, repository: string | undefined) =>
    `Before this: ${repository === undefined ? '' : `${repository} `}${change.short} ${change.prefix}${change.number}, ${change.state === 'open' ? 'open' : change.state} on ${host}.`,
  /** Commits after its last pull request merged or closed, in none yet. */
  /** In a task of several repositories, by none: they may be in a repository that has had no pull request yet. */
  unshipped: (n: number, change: ChangeSummary | undefined) =>
    `${n === 1 ? 'One commit' : `${n} commits`}${change === undefined ? '' : ` after ${change.short} ${change.prefix}${change.number}`} ${n === 1 ? 'isn’t' : 'aren’t'} in a pull request yet.`,
  push: (n: number) => (n === 1 ? 'Push 1 commit' : `Push ${n} commits`),
  pushTo: (n: number, repository: string) => `${n === 1 ? 'Push 1 commit' : `Push ${n} commits`} to ${repository}`,
  pushBranch: (remote: string) => `Push the branch to ${remote}`,
  openOn: (host: string) => `Open on ${host}`,
  conflicts: (into: string, files: string) => `It conflicts with ${into} as it is now, in ${files}.`,
  /** Merged and pushed, with nothing left between it and its base: said in a line. */
  mergedAll: (merged: ReadonlyArray<TaskRepositoryMerged>) => {
    const into = [...new Set(merged.map((one) => one.branch))].join(' and ')
    const remotes = [...new Set(merged.flatMap((one) => (one.remote === null ? [] : [one.remote.slice(0, one.remote.indexOf('/'))])))].join(
      ' and ',
    )
    return remotes === '' ? `Merged into ${into} on ${device.this}.` : `Merged into ${into}, and pushed to ${remotes}.`
  },
  /** Merged here: whether its remote has it yet. */
  merged: (merged: ReadonlyArray<TaskRepositoryMerged>) => {
    const into = [...new Set(merged.map((one) => one.branch))].join(' and ')
    const names = [...new Set(merged.flatMap((one) => (one.remote === null ? [] : [one.remote.slice(0, one.remote.indexOf('/'))])))]
    const remotes = names.join(' and ')
    if (merged.some((one) => one.ahead > 0))
      return `Into ${into} on ${device.this}. ${remotes} ${names.length > 1 ? 'don’t' : 'doesn’t'} have it yet.`
    if (merged.every((one) => one.remote === null)) return `Into ${into} on ${device.this}. It has no remote to push to.`
    return `Into ${into}, and pushed to ${remotes}.`
  },
  pushHere: (merged: ReadonlyArray<TaskRepositoryMerged>) => {
    const behind = merged.filter((one) => one.ahead > 0 && one.remote !== null)
    const [only] = behind
    return behind.length === 1 && only !== undefined
      ? `Push ${only.branch} to ${only.remote?.slice(0, only.remote.indexOf('/')) ?? ''}`
      : 'Push to each remote'
  },
  resolve: 'Ask the lead to resolve it',
  /** A pull request in a sentence, and by name: in a task of several, whose. */
  pullRequest: (change: ChangeSummary, several: boolean) =>
    several ? `${nameOf(change.repository)}’s ${change.noun}` : `the ${change.noun}`,
  named: (change: ChangeSummary) => `${change.short} ${change.prefix}${change.number}`,
  diffKey: modKey('D'),
}

/**
 * Where merging here conflicts, as Althar says it ("web: README.md; api:
 * a.ts" in a task of several, the files alone in one), with the branch each
 * merges into.
 */
export const conflictsOf = (conflict: string, here: ReadonlyArray<{ readonly name: string; readonly branch: string }>) =>
  conflict.split('; ').map((part) => {
    const at = part.indexOf(': ')
    const repository = at > 0 ? here.find((one) => one.name === part.slice(0, at)) : undefined
    return repository === undefined
      ? { name: null, branch: here[0]?.branch ?? 'main', files: part }
      : { name: repository.name, branch: repository.branch, files: part.slice(at + 2) }
  })

/** A repository by its name alone: `web` for `meridian/web`. */
const nameOf = (repository: string) => repository.slice(repository.lastIndexOf('/') + 1)

/** The files under a repository's folder, in a task of several, where each path starts with its name; all of them in a task of one. */
const filesIn = (files: ReadonlyArray<ChangedFile>, name: string, several: boolean) =>
  (several ? files.filter((file) => file.path.startsWith(`${name}/`)) : files).map((file) => ({
    path: file.path,
    add: file.add,
    del: file.del,
  }))

/** The model a reviewer ran on, as the plan named it. */
const reviewModelOf = (snapshot: ThreadSnapshot, agentId: string) =>
  snapshot.task.steps.find((step) => step.key === 'review' && step.agentId === agentId)?.model ?? null

/** What its last review said, and who reviewed it, over all its rounds; its words are in the conversation. */
const reviewOf = (snapshot: ThreadSnapshot, named: NameModel): ChangeReview | undefined => {
  const reviews = snapshot.items.flatMap((item) => (item.kind === 'step_result' && item.content.step === 'review' ? [item] : []))
  const last = reviews.at(-1)
  if (last === undefined) return undefined
  const by = [...new Set(reviews.flatMap((item) => (item.content.agentId === null ? [] : [item.content.agentId])))]
  return {
    state: last.content.verdict === 'changes_requested' ? CheckState.Failed : CheckState.Passed,
    by: by.map((id) => named(id, reviewModelOf(snapshot, id))),
  }
}

export function Outputs({
  snapshot,
  pending,
  doing: acting = null,
  error,
  onAccept,
  onMergeHere,
  onOpenChange,
  onPush,
  onMarkReady,
  onOpenFile,
  conflict = null,
  onResolve,
  onPushHere,
  onPushBranch,
  onConnect,
  refused = null,
  onReplace,
  onBringIn,
}: {
  snapshot: ThreadSnapshot
  pending: boolean
  /** Which action is on its way, where one is: only its button shows as working; the others wait. */
  doing?: Doing | null
  error: string | null
  /** The files merging it here conflicts in, after a merge refused for that. */
  conflict?: string | null
  /** Asks the lead to bring its branch up to date, settling the conflict. */
  onResolve?: () => void
  /** Pushes what it merged here to the remotes its branches follow. */
  onPushHere?: () => void
  /** Pushes its branch to its repositories' remotes, with the person's own git, no connection needed. */
  onPushBranch: () => void
  /** Opens where the project's code host is connected. */
  onConnect: () => void
  /** Accepts its pull requests: each merged on its host in turn, at the head shown, stopping at the first refused. */
  onAccept: (changes: ReadonlyArray<{ readonly head: string; readonly url: string }>) => void
  onMergeHere: () => void
  onOpenChange: () => void
  onPush: (head: string, url: string) => void
  /** The pull request a push was refused by for commits on it that aren't here, by its address. */
  refused?: string | null
  /** Replaces a pull request's commits with the branch, up to the head shown, while it is still at `replaces`: confirmed on the card. */
  onReplace: (head: string, replaces: string, url: string) => void
  /** Has the lead merge a pull request's commits into its branch, so a plain push works. */
  onBringIn: (url: string) => void
  onMarkReady: (url: string) => void
  /** Opens what it changed over the whole window, on a file or the first. */
  onOpenFile: (path?: string) => void
}) {
  const { task } = snapshot
  const named = useModelNames()
  const ready = task.phase === 'ready'
  const review = reviewOf(snapshot, named)
  // Its latest pull request in each repository, the open one else the newest; the others came before them.
  const { latest, earlier } = latestOf(task.changes)
  const open = latest.filter((change) => change.state !== 'closed')
  const closed = latest.filter((change) => change.state === 'closed')
  // Commits after its last pull request, in none yet: a new one opens for them, as the person says.
  const shipping = ready && task.unshipped != null && task.unshipped.commits > 0 && snapshot.host?.connected === true
  // Its repositories: those with a pull request, those still to merge here, and those merged here already.
  const several = open.length + task.here.length + task.merged.length > 1
  const [first] = open
  // Each card is read out by the task's title, as what it changed; and opens what it changed, or a file of it.
  const files = { onReviewDiff: () => onOpenFile(), diffKey: text.diffKey, onOpenFile }
  const label = { label: task.title }
  // Only the button pressed shows as working; while it does, the others wait.
  const pressed = (key: Doing) => ({ busy: acting === key, disabled: pending && acting !== key })

  // A branch its pull request won't take a plain push of, as Althar counts it or as a push just found: said, with what puts it right, not pushed.
  const parted = open.flatMap((one) =>
    one.state !== 'open' || one.localHead === null
      ? []
      : one.diverged !== null
        ? [{ change: one, ...one.diverged }]
        : refused === one.url
          ? [{ change: one, kind: 'moved' as const, local: one.unpushed, onPullRequest: null }]
          : [],
  )
  const pushes = open.filter(
    (one) => one.state === 'open' && one.unpushed > 0 && one.localHead !== null && !parted.some((p) => p.change.url === one.url),
  )
  const drafts = open.filter((one) => one.state === 'open' && one.draft)
  const openNew = shipping && (
    <Button key="new" variant="signal" {...pressed(doing.openChange)} onClick={onOpenChange}>
      {text.openNewChange}
    </Button>
  )

  // Its pull requests, as one change: merged once all are, a draft while any is, else ready to accept.
  const change =
    first === undefined
      ? null
      : (() => {
          const state = open.every((one) => one.state === 'merged')
            ? ChangeState.Merged
            : open.some((one) => one.state === 'open' && one.draft)
              ? ChangeState.Draft
              : ChangeState.Ready
          const brand = productBrand(first.product)
          const prs: PullRequest[] = open.map((one) => ({
            repo: one.repository,
            number: one.number,
            url: one.url,
            // Under its repository's folder here, which needn't be named as the host names it.
            files: filesIn(task.files, one.slug ?? nameOf(one.repository), several),
          }))
          const checked = open.some((one) => one.checks != null)
          // What the lead committed since goes up first: accepting merges what the pull request has.
          const accepting = ready && state === ChangeState.Ready && pushes.length === 0
          const actions: ReactNode[] = [
            ...pushes.map((one) => (
              <Button
                key={`push-${one.url}`}
                variant="signal"
                {...pressed(doing.push(one.url))}
                onClick={() => onPush(one.localHead ?? '', one.url)}
              >
                {several ? text.pushTo(one.unpushed, nameOf(one.repository)) : text.push(one.unpushed)}
              </Button>
            )),
            ...(accepting
              ? [
                  <Button
                    key="accept"
                    variant="signal"
                    {...pressed(doing.accept)}
                    // In order, each at the head shown, so one that moved on since isn't merged unseen; the rest wait on a refusal.
                    onClick={() => onAccept(open.flatMap((one) => (one.state === 'open' ? [{ head: one.head ?? '', url: one.url }] : [])))}
                  >
                    {text.accept(open.filter((one) => one.state === 'open').length)}
                  </Button>,
                ]
              : []),
            ...drafts.map((one) => (
              <Button key={`ready-${one.url}`} {...pressed(doing.markReady(one.url))} onClick={() => onMarkReady(one.url)}>
                {several ? text.markReadyIn(nameOf(one.repository)) : text.markReady}
              </Button>
            )),
            ...(openNew === false ? [] : [openNew]),
          ]
          return (
            <ChangeSet
              state={state}
              host={{ name: productName(first.product), ...(brand === undefined ? {} : { brand }) }}
              prs={prs}
              {...(checked ? { checks: open.flatMap((one) => (one.checks?.list ?? []).map(checkOf)) } : {})}
              {...(review === undefined ? {} : { review })}
              {...(actions.length === 0 ? {} : { actions })}
              {...files}
              {...(error === null ? {} : { error })}
              text={{
                ...label,
                pr: (n) => `${first.short} ${first.prefix}${n}`,
                named: (repo, n) => `${nameOf(repo)} ${first.prefix}${n}`,
                onHostLabel: (repo, n, on) => `Open ${repo} ${first.prefix}${n} on ${on}`,
              }}
            />
          )
        })()

  // A merge that conflicts is the lead's to settle: one press asks it.
  const conflicted = (
    <>
      {conflictsOf(conflict ?? '', task.here)
        .map((one) => text.conflicts(one.name === null ? one.branch : `${one.name}’s ${one.branch}`, one.files))
        .join(' ')}{' '}
      <Button size="small" onClick={onResolve}>
        {text.resolve}
      </Button>
    </>
  )

  // Merged here, beside a pull request or not: what is merged, and whether its remote has it, which one press pushes.
  const settledHere = task.here.length === 0 && task.merged.length > 0
  // Nothing left between it and its base, pushed or without a remote: a line says so, with no diff to show.
  const done =
    settledHere && !task.merged.some((one) => one.ahead > 0 && one.remote !== null) && task.files.length === 0 && task.commits === 0
  const local =
    settledHere && !done ? (
      <ChangeSet
        state={ChangeState.Merged}
        note={text.merged(task.merged)}
        prs={task.merged.map((repo) => ({ repo: repo.name, files: filesIn(task.files, repo.repository, several) }))}
        {...(review === undefined ? {} : { review })}
        {...files}
        {...(task.merged.some((one) => one.ahead > 0 && one.remote !== null) && onPushHere !== undefined
          ? {
              actions: (
                <Button variant="signal" {...pressed(doing.pushHere)} onClick={onPushHere}>
                  {text.pushHere(task.merged)}
                </Button>
              ),
            }
          : {})}
        {...(error === null ? {} : { error })}
        text={label}
      />
    ) : null

  // Where its branch stands on its repositories' remotes, pushed with the person's own git: there, behind, or not yet.
  const remotes = task.here.flatMap((repo) => (repo.remote == null ? [] : [repo.remote]))
  const remote =
    remotes.length === 0
      ? undefined
      : {
          name: [...new Set(remotes.map((one) => one.name))].join(', '),
          pushed: remotes.every((one) => one.pushed),
          ahead: remotes.reduce((sum, one) => sum + one.ahead, 0),
        }
  const pushedSomewhere = remotes.some((one) => one.pushed)

  // Work on its branch: the repositories without a pull request, which merge here once it is ready; before that, its branch so far.
  const branchOnly = first === undefined && task.merged.length === 0 && (task.files.length > 0 || task.commits > 0)
  // A pull request needs its host connected: without, there is nothing a press could open.
  const unpublished = ready && first === undefined && task.commits > 0 && snapshot.host?.connected === true
  const here =
    task.here.length > 0 || branchOnly
      ? (() => {
          const merging = ready && task.here.length > 0
          const actions: ReactNode[] = [
            ...(unpublished
              ? [
                  <Button key="open" variant="signal" {...pressed(doing.openChange)} onClick={onOpenChange}>
                    {text.openChange}
                  </Button>,
                ]
              : []),
            ...(merging
              ? [
                  <Button key="here" variant={unpublished ? 'default' : 'signal'} {...pressed(doing.mergeHere)} onClick={onMergeHere}>
                    {mergeHereLabel(task.here, first !== undefined)}
                  </Button>,
                ]
              : []),
            // Without a connection, pushing is the person's own git, as from a terminal: opening a pull request pushes it otherwise.
            ...(remote !== undefined && !unpublished && (!remote.pushed || remote.ahead > 0)
              ? [
                  <Button key="push" {...pressed(doing.pushBranch)} onClick={onPushBranch}>
                    {text.pushBranch(remote.name)}
                  </Button>,
                ]
              : []),
          ]
          return (
            <ChangeSet
              state={ChangeState.Branch}
              {...(ready ? {} : { note: text.sofar })}
              prs={
                task.here.length > 0
                  ? task.here.map((repo) => ({
                      repo: repo.name,
                      files: filesIn(task.files, repo.repository, several),
                      // Only where its remote has the branch: one push refused leaves the others' pages.
                      ...(repo.remote?.newPullRequest == null || !repo.remote.pushed
                        ? {}
                        : {
                            newPullRequest: { url: repo.remote.newPullRequest, ...hostOfPage(repo.remote.newPullRequest, snapshot.host) },
                          }),
                    }))
                  : [{ repo: snapshot.project.name, files: filesIn(task.files, '', false) }]
              }
              {...(remote === undefined ? {} : { remote })}
              {...(first === undefined && review !== undefined ? { review } : {})}
              {...(actions.length === 0 ? {} : { actions })}
              {...files}
              {...(first !== undefined
                ? {}
                : conflict !== null && onResolve !== undefined
                  ? { error: conflicted }
                  : error === null
                    ? {}
                    : { error })}
              text={label}
            />
          )
        })()
      : null

  // Pushed with no connection: what connecting would add, said once something is there to have a pull request.
  const offer =
    pushedSomewhere && snapshot.host !== null && !snapshot.host.connected ? (
      <p className={s.offer}>
        {text.connectAfterPush(snapshot.host.name)}{' '}
        <Button size="small" onClick={onConnect}>
          {text.connect(snapshot.host.name)}
        </Button>
      </p>
    ) : null

  const made = outcomeOf(snapshot)
  const telling = hasOutcome(made) || made.checked.length > 0 || made.unverified.length > 0
  const side = (
    <>
      {change}
      {parted.map(({ change: one, kind, local: ahead, onPullRequest }) => (
        <Diverged
          key={`parted-${one.url}`}
          kind={kind}
          local={ahead}
          onPullRequest={onPullRequest}
          pullRequest={text.pullRequest(one, several)}
          named={text.named(one)}
          // Only from the head the person saw it at: what anyone pushed since is never replaced.
          {...(kind === 'rewritten' && one.head !== null
            ? { onReplace: () => onReplace(one.localHead ?? '', one.head ?? '', one.url) }
            : {})}
          onMerge={() => onBringIn(one.url)}
          replacing={acting === doing.replace(one.url)}
          merging={acting === doing.bringIn(one.url)}
          locked={pending}
        />
      ))}
      {local}
      {done && <p className={s.quiet}>{text.mergedAll(task.merged)}</p>}
      {here}
      {offer}
      {closed.map((one) => (
        <p key={one.url} className={s.quiet}>
          {text.closed(one, productName(one.product))}
        </p>
      ))}
      {earlier.map((one) => (
        <p key={`earlier-${one.url}`} className={s.quiet}>
          {text.earlier(one, productName(one.product), several ? nameOf(one.repository) : undefined)}{' '}
          <a className={s.external} href={one.url} target="_blank" rel="noreferrer">
            {text.openOn(productName(one.product))}
          </a>
        </p>
      ))}
      {shipping && task.unshipped != null && (
        <p className={s.quiet}>
          {text.unshipped(task.unshipped.commits, several ? undefined : latest.findLast((one) => one.state !== 'open'))}
        </p>
      )}
      {/* With no pull request still open to hold it, a new one is pressed from here. */}
      {first === undefined && openNew}
    </>
  )
  const changed = change !== null || local !== null || here !== null || done || closed.length > 0 || earlier.length > 0 || shipping
  return (
    <div className={s.outputs}>
      <div className={telling && changed ? s.outputsWide : s.outputsAlone}>
        {telling && (
          <WhatItMade
            story={made.story}
            shots={made.shots}
            checked={made.checked}
            unverified={made.unverified}
            text={{ story: text.story(task.kind === 'change' || task.changes.length > 0 || task.files.length > 0) }}
          />
        )}
        {changed && <aside className={telling ? s.side : s.sideAlone}>{side}</aside>}
      </div>
    </div>
  )
}

/** The host a new pull request's page is on, by its name: the project's own host where it is that one, else as its address says. */
const hostOfPage = (url: string, host: ThreadSnapshot['host']): { host?: string } => {
  const name = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  })()
  if (host !== null && name !== '' && host.webUrl.includes(name)) return { host: host.name }
  const known = PAGE_HOSTS.find(([pattern]) => pattern.test(name))
  return known === undefined ? {} : { host: known[1] }
}

const PAGE_HOSTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^github\.com$/, 'GitHub'],
  [/(^|\.)gitlab\./, 'GitLab'],
  [/^bitbucket\.org$/, 'Bitbucket'],
  [/^codeberg\.org$/, 'Codeberg'],
  [/(^|\.)gitea\./, 'Gitea'],
  [/(^|\.)forgejo\./, 'Forgejo'],
]

/**
 * A task's pull requests as its outputs show them: in each of its
 * repositories the latest, the open one else the newest, and the earlier
 * ones of its rounds of work before it, newest first.
 */
export const latestOf = (changes: ReadonlyArray<ChangeSummary>) => {
  const byRepository = new Map<string, Array<ChangeSummary>>()
  for (const change of changes) {
    const where = change.slug ?? change.repository
    byRepository.set(where, [...(byRepository.get(where) ?? []), change])
  }
  const latest = [...byRepository.values()].flatMap((all) => {
    const one = all.find((change) => change.state === 'open') ?? all.at(-1)
    return one === undefined ? [] : [one]
  })
  return { latest, earlier: changes.filter((change) => !latest.includes(change)).toReversed() }
}

/** Whether a task has outputs to show: a pull request, or anything changed or committed on its branch. */
export const hasOutputs = ({ task }: ThreadSnapshot) =>
  task.changes.length > 0 || task.files.length > 0 || task.commits > 0 || task.here.length > 0 || task.merged.length > 0

/**
 * Whether its Outputs face has anything to show: what it changed, or, for
 * work that changed nothing in git, as a prototype in its scratch folder,
 * its pictures. One that only said what it found says nothing changed: its
 * answer is in the conversation.
 */
export const hasOutputsToShow = (snapshot: ThreadSnapshot) =>
  hasOutputs(snapshot) || (snapshot.task.kind !== 'review' && outcomeOf(snapshot).shots.length > 0)
