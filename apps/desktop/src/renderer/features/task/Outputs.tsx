import type { ChangeSummary, ChangedFile, TaskRepositoryMerged, ThreadSnapshot } from '@althar/contracts'
import { Button, type ChangeCheck, ChangeSet, ChangeState, CheckState, type ModelInfo, type PullRequest, ThreadMeasure } from '@althar/ui'

import { type NameModel, useModelNames } from '../../shared/modelNames'
import { checkOf } from '../../shared/checks'
import { mergeHereLabel } from '../../shared/mergeHere'
import { productBrand, productName } from '../../shared/products'
import s from './Task.module.css'
import { device } from '../../shared/device'

/*
 * A task's outputs: what it changed, as one change set, for deciding whether
 * to accept it. Its pull requests merge on their host when it is accepted,
 * up to the heads shown, and its repositories whose work ended on its branch
 * merge here. A draft is marked ready here, what the lead committed since is
 * pushed here, and sending it back is a note to the lead. Before it is
 * ready, the same card shows what it has changed so far.
 */

export const text = {
  title: 'What it changed',
  draftNote: 'Its checks run on it; mark it ready when you are',
  readyNote: 'Nothing merges until you accept it',
  branchNote: 'Not merged yet',
  /** Pushed without a connection: what connecting would add, in the host's name. */
  connectAfterPush: (host: string) =>
    `Connected to ${host}, Althar would open the pull request itself, bring its checks and reviews back to the lead, and merge it there when you accept it.`,
  connect: (host: string) => `Connect ${host}`,
  sofar: 'Its branch so far',
  closed: (change: ChangeSummary, host: string) => `${change.short} ${change.prefix}${change.number} was closed on ${host}.`,
  markReady: 'Mark ready for review',
  markReadyIn: (repository: string) => `Mark ${repository} ready for review`,
  openChange: 'Open a pull request',
  push: (n: number) => (n === 1 ? 'Push 1 commit' : `Push ${n} commits`),
  pushTo: (n: number, repository: string) => `${n === 1 ? 'Push 1 commit' : `Push ${n} commits`} to ${repository}`,
  unpushed: (n: number, change: ChangeSummary) =>
    n === 1 ? `One commit isn’t on the ${change.noun} yet.` : `${n} commits aren’t on the ${change.noun} yet.`,
  openOn: (host: string) => `Open on ${host}`,
  review: (round: number) => (round === 0 ? 'Review' : `Review · round ${round + 1}`),
  conflicts: (into: string, files: string) => `It conflicts with ${into} as it is now, in ${files}.`,
  /** Merged and pushed, with nothing left between it and its base: said in a line. */
  mergedAll: (merged: ReadonlyArray<TaskRepositoryMerged>) => {
    const into = [...new Set(merged.map((one) => one.branch))].join(' and ')
    const remotes = [...new Set(merged.flatMap((one) => (one.remote === null ? [] : [one.remote.slice(0, one.remote.indexOf('/'))])))].join(
      ' and ',
    )
    return remotes === '' ? `Merged into ${into} on ${device.this}.` : `Merged into ${into}, and pushed to ${remotes}.`
  },
  repositories: (n: number) => (n === 1 ? 'Repository' : 'Repositories'),
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
  /** What a review that asked for changes found; its words are in the conversation. */
  found: (n: number) => (n === 1 ? '1 finding' : `${n} findings`),
  diffKey: '⌘D',
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

/** What its reviews said, as checks: the last round of each step that reviewed it. */
const reviewsOf = (snapshot: ThreadSnapshot, named: NameModel): ReadonlyArray<ChangeCheck> => {
  const last = snapshot.items.findLast((item) => item.kind === 'step_result' && item.content.step === 'review')
  if (last?.kind !== 'step_result') return []
  const { round, verdict, findings, agentId } = last.content
  const asked = verdict === 'changes_requested'
  return [
    {
      id: `review-${round}`,
      name: text.review(round),
      state: asked ? CheckState.Failed : CheckState.Passed,
      ...(agentId === null ? {} : { by: [named(agentId, reviewModelOf(snapshot, agentId))] }),
      // How it went, not what it said: the reviewer's words are in the conversation.
      ...(asked && findings.length > 0 ? { detail: text.found(findings.length) } : {}),
    },
  ]
}

export function Outputs({
  snapshot,
  lead,
  pending,
  error,
  onAccept,
  onMergeHere,
  onOpenChange,
  onPush,
  onMarkReady,
  onSendBack,
  onOpenFile,
  conflict = null,
  onResolve,
  onPushHere,
  onPushBranch,
  onConnect,
}: {
  snapshot: ThreadSnapshot
  lead: ModelInfo
  pending: boolean
  error: string | null
  /** The files merging it here conflicts in, after a merge refused for that. */
  conflict?: string | null
  /** Asks the lead to bring its branch up to date, settling the conflict. */
  onResolve?: () => void
  /** Pushes what it merged here to the remotes its branches follow. */
  onPushHere?: () => void
  /** Pushes its branch to its repositories' remotes, with the person's own git, no connection needed. */
  onPushBranch?: () => void
  /** Opens where the project's code host is connected. */
  onConnect?: () => void
  /** Accepts its pull requests: each merged on its host in turn, at the head shown, stopping at the first refused. */
  onAccept: (changes: ReadonlyArray<{ readonly head: string; readonly url: string }>) => void
  onMergeHere: () => void
  onOpenChange: () => void
  onPush: (head: string, url: string) => void
  onMarkReady: (url: string) => void
  onSendBack: (note: string) => void
  /** Opens what it changed over the whole window, on a file or the first. */
  onOpenFile: (path?: string) => void
}) {
  const { task } = snapshot
  const named = useModelNames()
  const ready = task.phase === 'ready'
  const base = (task.baseRef ?? '').replace(/^origin\//, '')
  const reviewers = [
    ...new Set(
      snapshot.items.flatMap((item) =>
        item.kind === 'step_result' && item.content.step === 'review' && item.content.agentId !== null ? [item.content.agentId] : [],
      ),
    ),
  ].map((id) => named(id, reviewModelOf(snapshot, id)))
  const reviews = reviewsOf(snapshot, named)
  const open = task.changes.filter((change) => change.state !== 'closed')
  const closed = task.changes.filter((change) => change.state === 'closed')
  // Its repositories: those with a pull request, those still to merge here, and those merged here already.
  const several = open.length + task.here.length + task.merged.length > 1
  const [first] = open
  const common = { title: task.title, branch: task.branch ?? '', base, commits: task.commits, lead, reviewers, headingLevel: 2 as const }

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
          const checks = [...reviews, ...open.flatMap((one) => (one.checks?.list ?? []).map(checkOf))]
          return (
            <ChangeSet
              {...common}
              state={state}
              host={{ name: productName(first.product), ...(brand === undefined ? {} : { brand }) }}
              {...(state === ChangeState.Draft ? { note: text.draftNote } : state === ChangeState.Ready ? { note: text.readyNote } : {})}
              prs={prs}
              checks={checks}
              {...(ready && state === ChangeState.Ready
                ? {
                    // In order, each at the head shown, so one that moved on since isn't merged unseen; the rest wait on a refusal.
                    onAccept: () => onAccept(open.flatMap((one) => (one.state === 'open' ? [{ head: one.head ?? '', url: one.url }] : []))),
                    onSendBack,
                  }
                : {})}
              onReviewDiff={() => onOpenFile()}
              diffKey={text.diffKey}
              onOpenFile={onOpenFile}
              accepting={pending}
              {...(error === null ? {} : { error })}
              text={{
                number: (n) => `${first.prefix}${n}`,
                onHostLabel: (repo, n, on) => `Open ${repo} ${first.prefix}${n} on ${on}`,
                prs: (n) =>
                  first.noun === 'merge request'
                    ? n === 1
                      ? 'Merge request'
                      : 'Merge requests'
                    : n === 1
                      ? 'Pull request'
                      : 'Pull requests',
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

  // Merged here: what it merged, and whether its remote has it yet, which one press pushes.
  // Merged here, beside a pull request or not: what is merged, and whether its remote has it, which one press pushes.
  const settledHere = task.here.length === 0 && task.merged.length > 0
  // Nothing left between it and its base, pushed or without a remote: a line says so, with no diff to show.
  const done =
    settledHere && !task.merged.some((one) => one.ahead > 0 && one.remote !== null) && task.files.length === 0 && task.commits === 0
  const local =
    settledHere && !done ? (
      <ChangeSet
        {...common}
        state={ChangeState.Merged}
        note={text.merged(task.merged)}
        prs={task.merged.map((repo) => ({ repo: repo.name, files: filesIn(task.files, repo.repository, several) }))}
        checks={reviews}
        onReviewDiff={() => onOpenFile()}
        diffKey={text.diffKey}
        onOpenFile={onOpenFile}
        {...(task.merged.some((one) => one.ahead > 0 && one.remote !== null) && onPushHere !== undefined
          ? { onPush: onPushHere, pushing: pending }
          : {})}
        text={{ push: () => text.pushHere(task.merged), prs: text.repositories }}
        {...(error === null ? {} : { error })}
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
          ...(onPushBranch === undefined ? {} : { onPush: onPushBranch, pushing: pending }),
        }
  const pushedSomewhere = remotes.some((one) => one.pushed)

  // Work on its branch: the repositories without a pull request, which merge here once it is ready; before that, its branch so far.
  const branchOnly = first === undefined && task.merged.length === 0 && (task.files.length > 0 || task.commits > 0)
  const here =
    task.here.length > 0 || branchOnly ? (
      <ChangeSet
        {...common}
        state={ChangeState.Branch}
        note={ready ? text.branchNote : text.sofar}
        prs={
          task.here.length > 0
            ? task.here.map((repo) => ({
                repo: repo.name,
                files: filesIn(task.files, repo.repository, several),
                ...(repo.remote?.newPullRequest == null
                  ? {}
                  : { newPullRequest: { url: repo.remote.newPullRequest, ...hostOfPage(repo.remote.newPullRequest, snapshot.host) } }),
              }))
            : [{ repo: snapshot.project.name, files: filesIn(task.files, '', false) }]
        }
        checks={first === undefined ? reviews : []}
        {...(ready && task.here.length > 0 ? { onAccept: onMergeHere, ...(first === undefined ? { onSendBack } : {}) } : {})}
        onReviewDiff={() => onOpenFile()}
        diffKey={text.diffKey}
        onOpenFile={onOpenFile}
        accepting={pending}
        {...(first !== undefined
          ? {}
          : conflict !== null && onResolve !== undefined
            ? { error: conflicted }
            : error === null
              ? {}
              : { error })}
        {...(remote === undefined ? {} : { remote })}
        text={{ mergeHere: () => mergeHereLabel(task.here, first !== undefined) }}
      />
    ) : null
  // Pushed with no connection: what connecting would add, said once something is there to have a pull request.
  const offer =
    pushedSomewhere && snapshot.host !== null && !snapshot.host.connected && onConnect !== undefined ? (
      <p className={s.offer}>
        {text.connectAfterPush(snapshot.host.name)}{' '}
        <Button size="small" onClick={onConnect}>
          {text.connect(snapshot.host.name)}
        </Button>
      </p>
    ) : null

  const pushes = open.filter((one) => one.state === 'open' && one.unpushed > 0 && one.localHead !== null)
  const drafts = open.filter((one) => one.state === 'open' && one.draft)
  // A pull request needs its host connected: without, there is nothing a press could open.
  const unpublished = ready && first === undefined && task.commits > 0 && snapshot.host?.connected === true
  return (
    <div className={s.outputs}>
      <ThreadMeasure className={s.outputsBody}>
        {change}
        {local}
        {done && <p className={s.quiet}>{text.mergedAll(task.merged)}</p>}
        {here}
        {offer}
        {closed.map((one) => (
          <p key={one.url} className={s.quiet}>
            {text.closed(one, productName(one.product))}
          </p>
        ))}
        {pushes.map((one) => (
          <p key={`unpushed-${one.url}`} className={s.quiet}>
            {text.unpushed(one.unpushed, one)}
          </p>
        ))}
        {(pushes.length > 0 || drafts.length > 0 || unpublished || first !== undefined) && (
          <div className={s.changeActions}>
            {pushes.map((one) => (
              <Button key={`push-${one.url}`} variant="signal" busy={pending} onClick={() => onPush(one.localHead ?? '', one.url)}>
                {several ? text.pushTo(one.unpushed, nameOf(one.repository)) : text.push(one.unpushed)}
              </Button>
            ))}
            {drafts.map((one) => (
              <Button key={`ready-${one.url}`} busy={pending} onClick={() => onMarkReady(one.url)}>
                {several ? text.markReadyIn(nameOf(one.repository)) : text.markReady}
              </Button>
            ))}
            {unpublished && (
              <Button busy={pending} onClick={onOpenChange}>
                {text.openChange}
              </Button>
            )}
            {open.map((one) => (
              <a key={`on-${one.url}`} className={s.external} href={one.url} target="_blank" rel="noreferrer">
                {several ? `${text.openOn(productName(one.product))} · ${nameOf(one.repository)}` : text.openOn(productName(one.product))}
              </a>
            ))}
          </div>
        )}
      </ThreadMeasure>
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

/** Whether a task has outputs to show: a pull request, or anything changed or committed on its branch. */
export const hasOutputs = ({ task }: ThreadSnapshot) =>
  task.changes.length > 0 || task.files.length > 0 || task.commits > 0 || task.here.length > 0 || task.merged.length > 0
