import { Children, useState, type ReactNode } from 'react'

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
 * none, its branch by name, and what of it isn't pushed, if anything. Its
 * checks in a line, what failed named, opening to the list; its review in a
 * line, by whom. Then what can be done now, which the page gives: one
 * button, or two where it is a choice, beside the facts where the card is
 * wide and under them where it is narrow. Under it all, how big it is with
 * the one way into the diff, and its files: each listed with its lines,
 * under its folder where folders hold several; past twenty, by folder, the
 * most first, each opening to its files.
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
  /** Said beside its pull request where it isn't open for accepting; with no pull request and no branch named, in its place. */
  state: Record<ChangeState, string>
  /** A pull request by its number, alone: PR #258. */
  pr: (n: number) => string
  /** One of several, by its repository: meridian-api #1187. */
  named: (repo: string, n: number) => string
  onHostLabel: (repo: string, n: number, host: string) => string
  /** Work on its branch: its commits the remote doesn't have, and its files with changes no commit has, which no push takes. */
  unpushed: (n: number) => string
  uncommitted: (n: number) => string
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
  more: (n: number) => string
  fewer: string
}

export const changeSetText: ChangeSetText = {
  label: 'The change',
  state: {
    [ChangeState.Draft]: 'Draft',
    [ChangeState.Ready]: 'Ready to accept',
    [ChangeState.Merged]: 'Merged',
    [ChangeState.Queued]: 'In the merge queue',
    [ChangeState.Branch]: 'On its branch',
  },
  pr: (n) => `PR #${n}`,
  named: (repo, n) => `${repo.slice(repo.lastIndexOf('/') + 1)} #${n}`,
  onHostLabel: (repo, n, host) => `Open ${repo} #${n} on ${host}`,
  unpushed: (n) => (n === 1 ? '1 commit not pushed' : `${n.toLocaleString('en-US')} commits not pushed`),
  uncommitted: (n) => (n === 1 ? 'Uncommitted changes in 1 file' : `Uncommitted changes in ${n.toLocaleString('en-US')} files`),
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
  more: (n) => `${n} more folders`,
  fewer: 'Fewer folders',
}

export interface ChangeSetProps {
  state: ChangeState
  /** Where its pull requests live; none for work on its branch. */
  host?: CodeHost
  prs: readonly PullRequest[]
  /** Work on its branch, with no pull request: the branch, by name, which heads the card. */
  branch?: string
  /** Work on its branch, as its remote has it: the remote's name, whether it has the branch, and how many commits it doesn't have. */
  remote?: { readonly name: string; readonly pushed: boolean; readonly ahead: number }
  /** Work on its branch: how many of its files have changes not committed yet, which no push takes. */
  uncommitted?: number
  /** What pushes the commits its remote doesn't have, beside them: a quiet button. */
  push?: ReactNode
  /** A line under where it stands, where there is more to it: merged here, and whether its remote has it. */
  note?: ReactNode
  /** Its host's checks; without them, no line for them, and with none yet, a line saying so, unless it merged: none will run now. */
  checks?: readonly ChangeCheck[]
  review?: ChangeReview
  /** What can be done with it now: one button, or two where it's a choice; the first is the one to press. */
  actions?: ReactNode
  /** Why the last action did not go through: a note in a line or two, with a quiet button where one puts it right. */
  error?: ReactNode
  /** Open the whole diff. */
  onReviewDiff?: () => void
  /** The key that opens the diff, shown beside it; the consumer binds it. */
  diffKey?: string
  /** Open one file's diff. Without it, files are not links. */
  onOpenFile?: (path: string) => void
  /** Past twenty files, how many folders show before the rest are a press away. */
  folders?: number
  className?: string
  text?: Partial<ChangeSetText>
}

export function ChangeSet({
  state,
  host,
  prs,
  branch,
  remote,
  uncommitted = 0,
  push,
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
  const acting = actions !== undefined && actions !== null && actions !== false
  // Wide, one or two buttons sit beside what they act on; more, as several repositories' are, get a row of their own under it.
  const many = Children.toArray(actions).length > 2
  // Merged with no checks, none will run: nothing to say of them.
  const checked = checks !== undefined && (checks.length > 0 || state !== ChangeState.Merged)
  // The files at the top of the repository are under its name; in a task of several, each path starts with its own.
  const root = nameOf(prs[0]?.repo ?? '')
  return (
    <article className={cx(s.change, className)} aria-label={t.label}>
      <div className={cx(s.decide, acting && !many && s.acting)}>
        <div className={s.facts}>
          <Head state={state} host={host} prs={prs} branch={branch} remote={remote} uncommitted={uncommitted} push={push} t={t} />
          {note !== undefined && <p className={s.note}>{note}</p>}
          {(checked || review !== undefined) && (
            <div className={s.lines}>
              {checked && <ChecksLine checks={checks ?? []} t={t} />}
              {review !== undefined && <ReviewLine review={review} t={t} />}
            </div>
          )}
        </div>
        {acting && <div className={s.actions}>{actions}</div>}
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
          {files.length > LISTED ? (
            <Folders files={files} root={root} shown={folders} onOpenFile={onOpenFile} t={t} />
          ) : (
            <Listed files={files} root={root} onOpenFile={onOpenFile} t={t} />
          )}
        </div>
      )}
    </article>
  )
}

/** A repository by its name alone: `meridian-api` for `stripe-internal/meridian-api`. */
const nameOf = (repo: string) => repo.slice(repo.lastIndexOf('/') + 1)

/**
 * Its pull requests, each the one link to its host, with where it stands where it isn't open. Work with none: its branch, what of
 * it isn't pushed, and, where Althar can't open its pull request, the host's page for one.
 */
function Head({
  state,
  host,
  prs,
  branch,
  remote,
  uncommitted,
  push,
  t,
}: Pick<ChangeSetProps, 'state' | 'host' | 'prs' | 'branch' | 'remote' | 'push'> & { uncommitted: number; t: ChangeSetText }) {
  const several = prs.length > 1
  const numbered = prs.filter((pr) => pr.number !== undefined)
  const said = state === ChangeState.Draft || state === ChangeState.Merged || state === ChangeState.Queued ? t.state[state] : null
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
  // On its branch: what its remote doesn't have, if anything; all of it pushed and committed, nothing to say.
  const ahead = state === ChangeState.Branch ? (remote?.ahead ?? 0) : 0
  const pages = prs.flatMap((pr) => {
    const url = pr.newPullRequest === undefined ? undefined : safeHref(pr.newPullRequest.url)
    return url === undefined ? [] : [{ repo: pr.repo, url, host: pr.newPullRequest?.host }]
  })
  const [page] = pages
  return (
    <div className={s.head}>
      <p className={s.pr}>
        {branch === undefined || state !== ChangeState.Branch ? (
          <span className={s.prName}>{t.state[state]}</span>
        ) : (
          <span className={s.branch} title={branch}>
            <Icon name="branch" size={13} />
            <span className={s.branchName}>{branch}</span>
          </span>
        )}
      </p>
      {ahead > 0 && (
        <p className={s.standing}>
          <span>{t.unpushed(ahead)}</span>
          {push}
        </p>
      )}
      {state === ChangeState.Branch && uncommitted > 0 && <p className={s.standing}>{t.uncommitted(uncommitted)}</p>}
      {!several && page !== undefined && (
        <p className={s.standing}>
          <a className={s.page} href={page.url} target="_blank" rel="noreferrer">
            {t.newPullRequest(page.host)}
            <Icon name="external" size={10} />
          </a>
        </p>
      )}
      {several &&
        prs.map((pr) => {
          const its = pages.find((one) => one.repo === pr.repo)
          return (
            <p key={pr.repo} className={s.repo}>
              <span className={s.repoName}>{pr.repo}</span>
              {its !== undefined && (
                <a className={s.page} href={its.url} target="_blank" rel="noreferrer">
                  {t.newPullRequest(its.host)}
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

/** The folder a file is in, empty at the top of the repository. */
const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** By where they are: the top of the repository first, then by folder, then by name. */
const byPlace = (a: ChangedFile, b: ChangedFile) => {
  const [here, there] = [dirOf(a.path), dirOf(b.path)]
  if (here === there) return a.path.localeCompare(b.path)
  return here === '' ? -1 : there === '' ? 1 : here.localeCompare(there)
}

/**
 * Its files under the folder each is in, the top of the repository first;
 * or none where most folders hold one file, as a dependency update's
 * manifests do: there a heading would only say again what its one path says.
 */
export const groupsOf = (files: readonly ChangedFile[]): Folder[] | null => {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of [...files].sort(byPlace)) groups.set(dirOf(file.path), [...(groups.get(dirOf(file.path)) ?? []), file])
  return groups.size > files.length / 2 ? null : [...groups].map(([path, list]) => ({ path, files: list }))
}

/** The folders every one of the files is in, from the top. */
const commonOf = (files: readonly ChangedFile[]) =>
  files.reduce<string[] | null>((common, file) => {
    const dirs = file.path.split('/').slice(0, -1)
    if (common === null) return dirs
    const at = common.findIndex((dir, i) => dirs[i] !== dir)
    return at === -1 ? common : common.slice(0, at)
  }, null) ?? []

/**
 * Its files by folder, the most first, for a change too big to list. By
 * their top folder; a folder that holds only folders (apps/, packages/), or
 * one that holds most of the change, gives its own folders in its place.
 * Each is named by where its files are, two folders deep at most:
 * apps/desktop rather than apps, so the list says where the work is.
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

/** As many files as are listed themselves; past it, their folders, each opening to its files. */
const LISTED = 20

/** A folder's files, each by its path in it, opening its diff by its whole path; all on one scale. */
function FilesIn({
  folder,
  most,
  onOpenFile,
  t,
}: {
  folder: Folder
  most: number
  onOpenFile: ((path: string) => void) | undefined
  t: ChangeSetText
}) {
  const whole = (path: string) => (folder.path === '' ? path : `${folder.path}/${path}`)
  return (
    <FileChanges
      files={folder.files.map((file) => ({ ...file, path: folder.path === '' ? file.path : file.path.slice(folder.path.length + 1) }))}
      most={most}
      {...(onOpenFile === undefined ? {} : { onOpen: (path: string) => onOpenFile(whole(path)) })}
      text={{ open: (path) => t.openFile(whole(path)) }}
    />
  )
}

/** A change of a few files: each of them, by path, under its folder where folders hold several. */
function Listed({
  files,
  root,
  onOpenFile,
  t,
}: {
  files: readonly ChangedFile[]
  root: string
  onOpenFile: ((path: string) => void) | undefined
  t: ChangeSetText
}) {
  const most = Math.max(1, ...files.map((file) => file.add + file.del))
  const groups = groupsOf(files)
  if (groups === null) return <FilesIn folder={{ path: '', files: [...files].sort(byPlace) }} most={most} onOpenFile={onOpenFile} t={t} />
  return (
    <div className={s.groups}>
      {groups.map((folder) => (
        <div key={folder.path} className={s.group}>
          <p className={s.heading}>{folder.path === '' ? root : folder.path}</p>
          <FilesIn folder={folder} most={most} onOpenFile={onOpenFile} t={t} />
        </div>
      ))}
    </div>
  )
}

/** A change of many files: its folders, each with how much changed in it, opening to its files; past a few, the rest a press away. */
function Folders({
  files,
  root,
  shown,
  onOpenFile,
  t,
}: {
  files: readonly ChangedFile[]
  root: string
  shown: number
  onOpenFile: ((path: string) => void) | undefined
  t: ChangeSetText
}) {
  const [all, setAll] = useState(false)
  const folders = foldersOf(files)
  const most = Math.max(1, ...files.map((file) => file.add + file.del))
  // Folding away one or two folders saves nothing: they show.
  const cut = folders.length - shown <= 2 ? folders.length : shown
  const left = folders.length - cut
  return (
    <div className={s.folders}>
      {(all ? folders : folders.slice(0, cut)).map((folder) => (
        <Disclosure key={folder.path}>
          <DisclosureTrigger>
            <button type="button" className={s.folder}>
              <Caret />
              <span className={s.path}>{folder.path === '' ? root : folder.path}</span>
              <Delta add={folder.files.reduce((n, f) => n + f.add, 0)} del={folder.files.reduce((n, f) => n + f.del, 0)} />
              <span className={s.n}>{t.files(folder.files.length)}</span>
            </button>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={s.in}>
              <FilesIn folder={folder} most={most} onOpenFile={onOpenFile} t={t} />
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
