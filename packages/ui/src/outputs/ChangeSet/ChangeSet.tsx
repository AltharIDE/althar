import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { CodeHost } from '../../foundations/codeHost'
import { BrandMark } from '../../foundations/Marks/Marks'
import { ChangeState, CheckState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { Checks, type ChangeCheck } from '../../primitives/Checks/Checks'
import { Delta, FileChanges, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import s from './ChangeSet.module.css'

/*
 * What a task changed, beside what it is, for deciding on it: each thing
 * said once. Its pull requests, each the one link to its host; work with
 * none says where its branch is. Its checks in a line, what failed named,
 * opening to the list; its review in a line, by whom. Then what can be done
 * now, which the page gives: one button, or two where it is a choice. Under
 * it, how big it is with the one way into the diff, and its files by folder,
 * the most first, each opening to its files.
 */

export interface PullRequest {
  /** owner/name. */
  repo: string
  /** None for a repository whose work stays on its branch. */
  number?: number
  /** For work on its branch, where this repository's remote has it: the host's page for a new pull request from it, and the host's name where known. */
  newPullRequest?: { readonly url: string; readonly host?: string }
  /** Where it lives on the code host; a link only when it is http or https. */
  url?: string
  files: readonly ChangedFile[]
}

/** What its review said, and who reviewed it. */
export interface ChangeReview {
  state: CheckState
  by: readonly ModelInfo[]
}

export interface ChangeSetText {
  /** What the card is, read out. */
  label: string
  /** Said beside its pull request where it isn't open for accepting; on its branch with no remote, in its place. */
  state: Record<ChangeState, string>
  /** A pull request by its number, alone: PR #258. */
  pr: (n: number) => string
  /** One of several, by its repository: meridian-api #1187. */
  named: (repo: string, n: number) => string
  onHostLabel: (repo: string, n: number, host: string) => string
  /** Work on its branch, as its remote has it: not there yet, behind by some commits, or there. */
  notOn: (remote: string) => string
  behindOn: (n: number, remote: string) => string
  on: (remote: string) => string
  /** The host's page for a new pull request from the branch, pushed without a connection. */
  newPullRequest: (host: string | undefined) => string
  checksPassed: (n: number) => string
  checksFailed: (names: readonly string[]) => string
  checksRunning: (passed: number, total: number) => string
  checksHeld: (name: string) => string
  /** Before any check has started, as on a pull request just opened. */
  noChecks: string
  /** Opens the list of its checks, read out. */
  checks: string
  reviewed: Record<'passed' | 'failed' | 'running', string>
  files: (n: number) => string
  diff: string
  openFile: (path: string) => string
  /** The folder for files at the top of the repository. */
  root: string
  more: (n: number) => string
  fewer: string
}

export const changeSetText: ChangeSetText = {
  label: 'The change',
  state: {
    [ChangeState.Draft]: 'Draft',
    [ChangeState.Ready]: 'Ready to accept',
    [ChangeState.Merged]: 'Merged',
    [ChangeState.Branch]: 'On its branch',
  },
  pr: (n) => `PR #${n}`,
  named: (repo, n) => `${repo.slice(repo.lastIndexOf('/') + 1)} #${n}`,
  onHostLabel: (repo, n, host) => `Open ${repo} #${n} on ${host}`,
  notOn: (remote) => `Not on ${remote} yet`,
  behindOn: (n, remote) => (n === 1 ? `1 commit not on ${remote} yet` : `${n} commits not on ${remote} yet`),
  on: (remote) => `On ${remote}`,
  newPullRequest: (host) => (host === undefined ? 'Open a pull request' : `Open a pull request on ${host}`),
  checksPassed: (n) => (n === 1 ? '1 check passed' : `${n} checks passed`),
  checksFailed: (names) => (names.length === 1 ? `${names[0] ?? ''} failed` : `${names.length} checks failed: ${names.join(', ')}`),
  checksRunning: (passed, total) => `${passed} of ${total} checks passed, the rest running`,
  checksHeld: (name) => `${name} waits on your call`,
  noChecks: 'No checks have run yet',
  checks: 'Its checks',
  reviewed: { passed: 'Reviewed by', failed: 'Changes asked by', running: 'Being reviewed by' },
  files: (n) => (n === 1 ? '1 file' : `${n.toLocaleString('en-US')} files`),
  diff: 'Review the diff',
  openFile: (path) => `Open the diff of ${path}`,
  root: 'Top level',
  more: (n) => `${n} more folders`,
  fewer: 'Fewer folders',
}

export interface ChangeSetProps {
  state: ChangeState
  /** Where its pull requests live; none for work on its branch. */
  host?: CodeHost
  prs: readonly PullRequest[]
  /** Work on its branch, as its remote has it: the remote's name, whether it has the branch, and how many commits it doesn't have. */
  remote?: { readonly name: string; readonly pushed: boolean; readonly ahead: number }
  /** A line under where it stands, where there is more to it: merged here, and whether its remote has it. */
  note?: ReactNode
  /** Its host's checks; without them, no line for them, and with none yet, a line saying so. */
  checks?: readonly ChangeCheck[]
  review?: ChangeReview
  /** What can be done with it now: one button, or two where it's a choice. The first is as wide as the card. */
  actions?: ReactNode
  /** Why the last action did not go through. */
  error?: ReactNode
  /** Open the whole diff. */
  onReviewDiff?: () => void
  /** The key that opens the diff, shown beside it; the consumer binds it. */
  diffKey?: string
  /** Open one file's diff. Without it, files are not links. */
  onOpenFile?: (path: string) => void
  /** How many folders show before the rest are a press away. */
  folders?: number
  className?: string
  text?: Partial<ChangeSetText>
}

export function ChangeSet({
  state,
  host,
  prs,
  remote,
  note,
  checks,
  review,
  actions,
  error,
  onReviewDiff,
  diffKey,
  onOpenFile,
  folders = 6,
  className,
  text,
}: ChangeSetProps) {
  const t = {
    ...changeSetText,
    ...text,
    state: { ...changeSetText.state, ...text?.state },
    reviewed: { ...changeSetText.reviewed, ...text?.reviewed },
  }
  const files = prs.flatMap((pr) => pr.files)
  return (
    <article className={cx(s.change, className)} aria-label={t.label}>
      <div className={s.decide}>
        <div className={s.facts}>
          <Head state={state} host={host} prs={prs} remote={remote} t={t} />
          {note !== undefined && <p className={s.note}>{note}</p>}
          {(checks !== undefined || review !== undefined) && (
            <div className={s.lines}>
              {checks !== undefined && <ChecksLine checks={checks} t={t} />}
              {review !== undefined && <ReviewLine review={review} t={t} />}
            </div>
          )}
        </div>
        {actions !== undefined && actions !== null && actions !== false && <div className={s.actions}>{actions}</div>}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {files.length > 0 && (
        <div className={s.files}>
          <div className={s.size}>
            <span className={s.count}>{t.files(files.length)}</span>
            <Delta add={files.reduce((n, f) => n + f.add, 0)} del={files.reduce((n, f) => n + f.del, 0)} />
            {onReviewDiff && (
              <Button className={s.diff} variant="quiet" size="small" kbd={diffKey} onClick={onReviewDiff}>
                {t.diff}
              </Button>
            )}
          </div>
          <Folders files={files} shown={folders} onOpenFile={onOpenFile} t={t} />
        </div>
      )}
    </article>
  )
}

/** Its pull requests, each the one link to its host, with where it stands where it isn't open; work with none, where its branch is. */
function Head({ state, host, prs, remote, t }: Pick<ChangeSetProps, 'state' | 'host' | 'prs' | 'remote'> & { t: ChangeSetText }) {
  const several = prs.length > 1
  const numbered = prs.filter((pr) => pr.number !== undefined)
  const said = state === ChangeState.Draft || state === ChangeState.Merged ? t.state[state] : null
  if (numbered.length > 0)
    return (
      <div className={s.head}>
        {numbered.map((pr, i) => {
          const n = pr.number ?? 0
          const link = host === undefined ? undefined : safeHref(pr.url)
          const name = several ? t.named(pr.repo, n) : t.pr(n)
          return (
            <p key={`${pr.repo}${n}`} className={s.pr}>
              {link === undefined || host === undefined ? (
                <span className={s.prName}>
                  {host?.brand && <BrandMark brand={host.brand} size={13} />}
                  {name}
                </span>
              ) : (
                <a className={s.prLink} href={link} target="_blank" rel="noreferrer" aria-label={t.onHostLabel(pr.repo, n, host.name)}>
                  {host.brand && <BrandMark brand={host.brand} size={13} />}
                  <span>{name}</span>
                  <Icon name="external" size={10} />
                </a>
              )}
              {i === 0 && said !== null && <span className={s.state}>{said}</span>}
            </p>
          )
        })}
      </div>
    )
  // On its branch: where its remote has it, else where it stands; each repository, where there are several, with its page for a pull request.
  const where =
    state !== ChangeState.Branch || remote === undefined
      ? t.state[state]
      : !remote.pushed
        ? t.notOn(remote.name)
        : remote.ahead > 0
          ? t.behindOn(remote.ahead, remote.name)
          : t.on(remote.name)
  return (
    <div className={s.head}>
      <p className={s.pr}>
        <span className={s.prName}>{where}</span>
      </p>
      {prs.map((pr) => {
        const page = pr.newPullRequest === undefined ? undefined : safeHref(pr.newPullRequest.url)
        if (!several && page === undefined) return null
        return (
          <p key={pr.repo} className={s.repo}>
            {several && <span className={s.repoName}>{pr.repo}</span>}
            {page !== undefined && (
              <a className={s.page} href={page} target="_blank" rel="noreferrer">
                {t.newPullRequest(pr.newPullRequest?.host)}
                <Icon name="external" size={10} />
              </a>
            )}
          </p>
        )
      })}
    </div>
  )
}

/** Its checks in a line: what failed by name, else what waits on you, else how far they are; opening to the list. */
function ChecksLine({ checks, t }: { checks: readonly ChangeCheck[]; t: ChangeSetText }) {
  if (checks.length === 0) return <p className={cx(s.line, s.quiet)}>{t.noChecks}</p>
  const failed = checks.filter((check) => check.state === CheckState.Failed)
  const held = checks.find((check) => check.state === CheckState.Held)
  const passed = checks.filter((check) => check.state === CheckState.Passed).length
  const [mark, said, tone] =
    failed.length > 0
      ? [<Icon key="m" name="close" size={12} />, t.checksFailed(failed.map((check) => check.name)), s.bad]
      : held !== undefined
        ? [<span key="m" className={s.you} aria-hidden="true" />, t.checksHeld(held.name), s.held]
        : passed < checks.length
          ? [<LiveDot key="m" ping />, t.checksRunning(passed, checks.length), s.running]
          : [<Icon key="m" name="check" size={12} />, t.checksPassed(checks.length), s.good]
  return (
    <Disclosure>
      <DisclosureTrigger>
        <button type="button" className={cx(s.line, s.opens, tone)} aria-label={`${t.checks}: ${said}`}>
          <span className={s.mark}>{mark}</span>
          <span className={s.said} title={said}>
            {said}
          </span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.list}>
          <Checks checks={checks} />
        </div>
      </Fold>
    </Disclosure>
  )
}

function ReviewLine({ review, t }: { review: ChangeReview; t: ChangeSetText }) {
  const [mark, said, tone] =
    review.state === CheckState.Failed
      ? [<Icon key="m" name="close" size={12} />, t.reviewed.failed, s.bad]
      : review.state === CheckState.Passed
        ? [<Icon key="m" name="check" size={12} />, t.reviewed.passed, s.good]
        : [<LiveDot key="m" ping />, t.reviewed.running, s.running]
  return (
    <p className={cx(s.line, tone)}>
      <span className={s.mark}>{mark}</span>
      <span className={s.said}>
        {said}{' '}
        {review.by.map((model) => (
          <Model key={model.id} model={model} className={s.model} />
        ))}
      </span>
    </p>
  )
}

/** A folder of its files: its path, and its files with their own paths in it. */
export interface Folder {
  /** Empty for files at the top of the repository. */
  readonly path: string
  readonly files: readonly ChangedFile[]
}

const parentOf = (path: string, depth: number) => path.split('/').slice(0, depth).join('/')

/** The folders every one of the files is in, from the top. */
const commonOf = (files: readonly ChangedFile[]) =>
  files.reduce<string[] | null>((common, file) => {
    const dirs = file.path.split('/').slice(0, -1)
    if (common === null) return dirs
    const at = common.findIndex((dir, i) => dirs[i] !== dir)
    return at === -1 ? common : common.slice(0, at)
  }, null) ?? []

/**
 * Its files by folder, the most first. By their top folder; a folder that
 * holds only folders (apps/, packages/), or one that holds most of the
 * change, gives its own folders in its place. Each is named by where its
 * files are, two folders deep at most: apps/desktop rather than apps, so the
 * list says where the work is.
 */
export const foldersOf = (files: readonly ChangedFile[]): Folder[] => {
  const groups = new Map<string, ChangedFile[]>()
  const add = (key: string, file: ChangedFile) => groups.set(key, [...(groups.get(key) ?? []), file])
  for (const file of files) add(file.path.includes('/') ? parentOf(file.path, 1) : '', file)
  for (let pass = 0; pass < 3; pass++) {
    // A copy: a folder split is taken out of the map and its own folders put in.
    for (const [key, list] of Array.from(groups)) {
      const depth = key.split('/').length
      // Two folders deep says where; deeper says how the code is laid out.
      if (key === '' || depth >= 2) continue
      const inside = list.filter((file) => file.path.split('/').length > depth + 1)
      const children = new Set(inside.map((file) => parentOf(file.path, depth + 1)))
      const only = inside.length === list.length
      const most = list.length > files.length / 2 && groups.size < 3
      if (children.size < 2 || !(only || most)) continue
      groups.delete(key)
      for (const file of list) add(inside.includes(file) ? parentOf(file.path, depth + 1) : key, file)
    }
  }
  return [...groups]
    .map(([key, list]) => {
      if (key === '') return { path: '', files: list }
      const common = commonOf(list)
      return { path: common.slice(0, Math.max(key.split('/').length, Math.min(common.length, 2))).join('/'), files: list }
    })
    .sort((a, b) => b.files.length - a.files.length || a.path.localeCompare(b.path))
}

/** As many files as show without opening their folders. */
const FEW = 8

function Folders({
  files,
  shown,
  onOpenFile,
  t,
}: {
  files: readonly ChangedFile[]
  shown: number
  onOpenFile: ((path: string) => void) | undefined
  t: ChangeSetText
}) {
  const [all, setAll] = useState(false)
  const folders = foldersOf(files)
  // Folding away one or two folders saves nothing: they show.
  const cut = folders.length - shown <= 2 ? folders.length : shown
  const left = folders.length - cut
  // A change of a few files shows them: a press each to open its folder would hide them for nothing.
  const few = files.length <= FEW
  return (
    <div className={s.folders}>
      {(all ? folders : folders.slice(0, cut)).map((folder) => (
        <Disclosure key={folder.path} defaultOpen={few}>
          <DisclosureTrigger>
            <button type="button" className={s.folder}>
              <Caret />
              <span className={s.path}>{folder.path === '' ? t.root : folder.path}</span>
              <span className={s.n}>{folder.files.length}</span>
            </button>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={s.in}>
              <FileChanges
                files={folder.files.map((file) => ({
                  ...file,
                  path: folder.path === '' ? file.path : file.path.slice(folder.path.length + 1),
                }))}
                {...(onOpenFile === undefined
                  ? {}
                  : { onOpen: (path: string) => onOpenFile(folder.path === '' ? path : `${folder.path}/${path}`) })}
                text={{ open: (path) => t.openFile(folder.path === '' ? path : `${folder.path}/${path}`) }}
              />
            </div>
          </Fold>
        </Disclosure>
      ))}
      {left > 0 && (
        <LinkButton className={s.more} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t.fewer : t.more(left)}
        </LinkButton>
      )}
    </div>
  )
}
