import type { ChangeSummary, ChangedFile, ThreadSnapshot } from '@althar/contracts'
import { Button, type ChangeCheck, ChangeSet, ChangeState, CheckState, type ModelInfo, type PullRequest, ThreadMeasure } from '@althar/ui'

import { modelInfo } from '../../shared/agents'
import { checkOf } from '../../shared/checks'
import { mergeHereLabel } from '../../shared/mergeHere'
import { productBrand, productName } from '../../shared/products'
import s from './Task.module.css'

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
  branchNote: 'Nothing was pushed; it merges here, on this Mac',
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
  diffKey: '⌘D',
}

/** A repository by its name alone: `web` for `meridian/web`. */
const nameOf = (repository: string) => repository.slice(repository.lastIndexOf('/') + 1)

/** The files under a repository's folder, in a task of several, where each path starts with its name; all of them in a task of one. */
const filesIn = (files: ReadonlyArray<ChangedFile>, name: string, several: boolean) =>
  (several ? files.filter((file) => file.path.startsWith(`${name}/`)) : files).map((file) => ({
    path: file.path,
    add: file.add,
    del: file.del,
  }))

/** What its reviews said, as checks: the last round of each step that reviewed it. */
const reviewsOf = (snapshot: ThreadSnapshot, agentName: (id: string | null) => string): ReadonlyArray<ChangeCheck> => {
  const last = snapshot.items.findLast((item) => item.kind === 'step_result' && item.content.step === 'review')
  if (last?.kind !== 'step_result') return []
  const { round, verdict, summary, agentId } = last.content
  return [
    {
      id: `review-${round}`,
      name: text.review(round),
      state: verdict === 'changes_requested' ? CheckState.Failed : CheckState.Passed,
      ...(agentId === null ? {} : { by: [modelInfo({ id: agentId, name: agentName(agentId) }, null)] }),
      ...(summary === '' ? {} : { detail: summary.split('\n')[0] ?? '' }),
    },
  ]
}

export function Outputs({
  snapshot,
  lead,
  agentName,
  pending,
  error,
  onAccept,
  onMergeHere,
  onOpenChange,
  onPush,
  onMarkReady,
  onSendBack,
  onOpenFile,
}: {
  snapshot: ThreadSnapshot
  lead: ModelInfo
  agentName: (id: string | null) => string
  pending: boolean
  error: string | null
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
  const ready = task.phase === 'ready'
  const base = (task.baseRef ?? '').replace(/^origin\//, '')
  const reviewers = [
    ...new Set(
      snapshot.items.flatMap((item) =>
        item.kind === 'step_result' && item.content.step === 'review' && item.content.agentId !== null ? [item.content.agentId] : [],
      ),
    ),
  ].map((id) => modelInfo({ id, name: agentName(id) }, null))
  const reviews = reviewsOf(snapshot, agentName)
  const open = task.changes.filter((change) => change.state !== 'closed')
  const closed = task.changes.filter((change) => change.state === 'closed')
  const several = open.length + task.here.length > 1
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

  // Work on its branch: the repositories without a pull request, which merge here once it is ready; before that, its branch so far.
  const branchOnly = first === undefined && (task.files.length > 0 || task.commits > 0)
  const here =
    task.here.length > 0 || branchOnly ? (
      <ChangeSet
        {...common}
        state={ChangeState.Branch}
        note={ready ? text.branchNote : text.sofar}
        prs={
          task.here.length > 0
            ? task.here.map((repo) => ({ repo: repo.name, files: filesIn(task.files, repo.repository, several) }))
            : [{ repo: snapshot.project.name, files: filesIn(task.files, '', false) }]
        }
        checks={first === undefined ? reviews : []}
        {...(ready && task.here.length > 0 ? { onAccept: onMergeHere, ...(first === undefined ? { onSendBack } : {}) } : {})}
        onReviewDiff={() => onOpenFile()}
        diffKey={text.diffKey}
        onOpenFile={onOpenFile}
        accepting={pending}
        {...(error === null || first !== undefined ? {} : { error })}
        text={{ mergeHere: () => mergeHereLabel(task.here, first !== undefined) }}
      />
    ) : null

  const pushes = open.filter((one) => one.state === 'open' && one.unpushed > 0 && one.localHead !== null)
  const drafts = open.filter((one) => one.state === 'open' && one.draft)
  const unpublished = ready && first === undefined && task.commits > 0
  return (
    <div className={s.outputs}>
      <ThreadMeasure className={s.outputsBody}>
        {change}
        {here}
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

/** Whether a task has outputs to show: a pull request, or anything changed or committed on its branch. */
export const hasOutputs = ({ task }: ThreadSnapshot) =>
  task.changes.length > 0 || task.files.length > 0 || task.commits > 0 || task.here.length > 0
