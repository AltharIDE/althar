import { Children, type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { CodeHost } from '../../foundations/codeHost'
import { BrandMark } from '../../foundations/Marks/Marks'
import { CheckState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import type { ChangeCheck } from '../../primitives/Checks/Checks'
import { Delta, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import { Problem } from '../../primitives/Problem/Problem'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { type ChangeReview, ChangeFiles, ChangeReviewLine, type ChangeSetText, ChecksLine, changeSetText } from './ChangeSet'
import s from './ChangeSet.module.css'
import t from './ChangeTrack.module.css'

/*
 * A change across several repositories, a pull request in each, as one
 * track: each repository a numbered stop, in the order they merge, so what
 * the others build on goes first. Each stop is its pull request, the one
 * link to its host, with where it stands where it isn't simply open, and
 * one line: what stops it first, else its checks, opening to the list.
 * Merged stops fill in as they go, and the track through them; one its host
 * refused stops the line there, saying why. The review, once, for all of
 * them. Then what can be done now, which the page gives. Under it all, how
 * big it is with the one way into the diff, and its files under each
 * repository by their paths in it, or one repository's alone.
 */

/**
 * Where one repository's pull request stands on the way in: a `draft`, `open` for accepting, `queued` in its branch's merge
 * queue, `merging` now, `waiting` for the one before it to merge first, `merged`, or `refused` by its host as it merged.
 */
export type TrackStanding = 'draft' | 'open' | 'queued' | 'merging' | 'waiting' | 'merged' | 'refused'

/** One repository's part of the change: its pull request, where it stands, and its files. */
export interface TrackStop {
  /** Its repository, by name alone: engine. */
  name: string
  /** Its pull request, in its host's words: !52, #27. */
  number: string
  /** Where it lives on its host; a link only when it is http or https. */
  url?: string
  /** Where it lives: its name, for words, and its mark. Repositories of one change can live on different hosts. */
  host?: CodeHost
  standing: TrackStanding
  /** The branch it merges into: main. */
  target?: string
  /** Its host's checks; without them, no line for them. */
  checks?: readonly ChangeCheck[]
  /** Its host says it conflicts with its target, so it can't merge until its branch is brought up to date. */
  conflicts?: boolean
  /** Why its host refused to merge it, where it did. */
  refused?: string
  /** Its files, by their paths in its repository. */
  files: readonly ChangedFile[]
  /** Its folder in the task's worktree, which a file's path there starts with; without it, a file's path is its path in it. */
  folder?: string
}

export interface ChangeTrackText extends Pick<
  ChangeSetText,
  | 'label'
  | 'noChecks'
  | 'checksPassed'
  | 'checksFailed'
  | 'checksRunning'
  | 'checksHeld'
  | 'reviewed'
  | 'files'
  | 'diff'
  | 'openFile'
  | 'more'
  | 'fewer'
> {
  /** The track, read out. */
  order: string
  /** Said beside its pull request where it is a draft or in its branch's merge queue; the rest its line says. */
  draft: string
  queued: string
  /** A pull request by its repository and number: engine !52. */
  named: (name: string, number: string) => string
  onHostLabel: (name: string, number: string, host: string) => string
  /** Its checks, read out: whose they are. */
  checksOf: (name: string) => string
  merged: (target: string) => string
  merging: (target: string) => string
  /** Waiting on the one before it, by name. */
  after: (name: string) => string
  conflicts: (target: string) => string
  /** Its host refused it, and why, where it said. */
  refused: (why: string | undefined) => string
  /** Its files, all of them or one repository's: the choice, read out, and its first option. */
  filesOf: string
  all: string
}

export const changeTrackText: ChangeTrackText = {
  label: changeSetText.label,
  noChecks: changeSetText.noChecks,
  checksPassed: changeSetText.checksPassed,
  checksFailed: changeSetText.checksFailed,
  checksRunning: (passed, total) => `${passed} of ${total} checks passed`,
  checksHeld: changeSetText.checksHeld,
  reviewed: changeSetText.reviewed,
  files: changeSetText.files,
  diff: changeSetText.diff,
  openFile: changeSetText.openFile,
  more: changeSetText.more,
  fewer: changeSetText.fewer,
  order: 'In the order they merge',
  draft: 'Draft',
  queued: 'In the merge queue',
  named: (name, number) => `${name} ${number}`,
  onHostLabel: (name, number, host) => `Open ${name} ${number} on ${host}`,
  checksOf: (name) => `${name}’s checks`,
  merged: (target) => `Merged into ${target}`,
  merging: (target) => `Merging into ${target}`,
  after: (name) => `Merges after ${name}`,
  conflicts: (target) => `Conflicts with ${target}`,
  refused: (why) => (why === undefined || why === '' ? 'Not merged' : `Not merged: ${why}`),
  filesOf: 'Files of',
  all: 'All',
}

export interface ChangeTrackProps {
  /** Its repositories, in the order they merge. */
  stops: readonly TrackStop[]
  review?: ChangeReview
  /** What can be done with it now: one button, or two where it's a choice; the first is the one to press. */
  actions?: ReactNode
  /** Why the last action did not go through, where no stop says it: a problem in a line or two, under the buttons. */
  error?: ReactNode
  /** Open the whole diff. */
  onReviewDiff?: () => void
  /** The key that opens the diff, shown beside it; the consumer binds it. */
  diffKey?: string
  /** Open one file's diff, by its path in the worktree (its repository's folder first). Without it, files are not links. */
  onOpenFile?: (path: string) => void
  /** Past twenty files in a repository, how many of its folders show before the rest are a press away. */
  folders?: number
  className?: string
  text?: Partial<ChangeTrackText>
}

/** Every repository's files, by a value no repository's name can be: names have no spaces. */
const ALL = ' all'

export function ChangeTrack({
  stops,
  review,
  actions,
  error,
  onReviewDiff,
  diffKey,
  onOpenFile,
  folders = 6,
  className,
  text,
}: ChangeTrackProps) {
  const w = { ...changeTrackText, ...text, reviewed: { ...changeTrackText.reviewed, ...text?.reviewed } }
  const [chosen, choose] = useState(ALL)
  const withFiles = stops.filter((stop) => stop.files.length > 0)
  // One repository's files, while it still has some; else every repository's.
  const one = withFiles.find((stop) => stop.name === chosen)
  const shown = one === undefined ? withFiles : [one]
  const files = shown.flatMap((stop) => stop.files)
  // Every bar on one scale, whichever is shown, so a repository's look as big beside the others' as they are.
  const most = Math.max(1, ...withFiles.flatMap((stop) => stop.files.map((file) => file.add + file.del)))
  const acting = actions !== undefined && actions !== null && actions !== false
  const many = Children.toArray(actions).length > 2
  const whole = (stop: TrackStop) => (path: string) => onOpenFile?.(stop.folder === undefined ? path : `${stop.folder}/${path}`)
  // Into one repository's diff, from its first file; into the whole diff from them all.
  const first = one === undefined ? undefined : [...one.files].sort((a, b) => a.path.localeCompare(b.path))[0]
  const toDiff =
    one === undefined ? onReviewDiff : first === undefined || onOpenFile === undefined ? undefined : () => whole(one)(first.path)
  return (
    <article className={cx(s.change, className)} aria-label={w.label}>
      <div className={cx(s.decide, acting && !many && s.acting)}>
        <div className={s.facts}>
          <ol className={t.track} aria-label={w.order}>
            {stops.map((stop, at) => (
              <Stop key={`${stop.name}${stop.number}`} stop={stop} at={at} before={stops[at - 1]} w={w} />
            ))}
          </ol>
          {review !== undefined && (
            <div className={s.lines}>
              <ChangeReviewLine review={review} t={w} />
            </div>
          )}
        </div>
        {acting && <div className={cx(s.actions, t.acts)}>{actions}</div>}
        {error && (
          <Problem size="small" className={s.problem}>
            {error}
          </Problem>
        )}
      </div>
      {withFiles.length > 0 && (
        <div className={s.files}>
          {withFiles.length > 1 && (
            <Segmented<string>
              label={w.filesOf}
              value={one === undefined ? ALL : one.name}
              onChange={choose}
              className={t.tabs}
              options={[{ value: ALL, label: w.all }, ...withFiles.map((stop) => ({ value: stop.name, label: stop.name }))]}
            />
          )}
          <div className={s.size}>
            <span className={s.count}>{w.files(files.length)}</span>
            <Delta add={files.reduce((n, f) => n + f.add, 0)} del={files.reduce((n, f) => n + f.del, 0)} />
            {toDiff !== undefined && (
              <Button className={s.diff} variant="quiet" size="small" kbd={one === undefined ? diffKey : undefined} onClick={toDiff}>
                {w.diff}
              </Button>
            )}
          </div>
          {shown.length === 1 && shown[0] !== undefined ? (
            <ChangeFiles
              files={shown[0].files}
              root={shown[0].name}
              folders={folders}
              most={most}
              onOpenFile={onOpenFile === undefined ? undefined : whole(shown[0])}
              t={{ ...w, openFile: (path) => w.openFile(`${shown[0]?.name ?? ''}/${path}`) }}
            />
          ) : (
            <div className={t.repositories}>
              {shown.map((stop) => (
                <section key={stop.name} className={t.repository} aria-label={stop.name}>
                  <h3 className={t.repositoryName}>{stop.name}</h3>
                  <ChangeFiles
                    files={stop.files}
                    root={stop.name}
                    folders={folders}
                    most={most}
                    onOpenFile={onOpenFile === undefined ? undefined : whole(stop)}
                    t={{ ...w, openFile: (path) => w.openFile(`${stop.name}/${path}`) }}
                  />
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

/** What stops it, where something does: its host refused it, it conflicts, or a check failed. */
const stoppedOf = (stop: TrackStop) =>
  stop.standing === 'refused' ||
  (stop.standing !== 'merged' && (stop.conflicts === true || (stop.checks ?? []).some((check) => check.state === CheckState.Failed)))

/** How its stop is drawn: filled once merged, red where it is stopped, dashed while a draft. */
const nodeOf = (stop: TrackStop) =>
  stop.standing === 'merged'
    ? t.merged
    : stop.standing === 'merging'
      ? t.merging
      : stoppedOf(stop)
        ? t.stopped
        : stop.standing === 'draft'
          ? t.draft
          : stop.standing === 'waiting'
            ? t.waiting
            : t.open

/** One repository on the track: its number, or its mark once merged; its pull request; and its one line. */
function Stop({ stop, at, before, w }: { stop: TrackStop; at: number; before: TrackStop | undefined; w: ChangeTrackText }) {
  const target = stop.target ?? 'main'
  const word = stop.standing === 'draft' ? w.draft : stop.standing === 'queued' ? w.queued : null
  return (
    <li className={cx(t.stop, nodeOf(stop))}>
      <span className={t.node} aria-hidden="true">
        {stop.standing === 'merged' ? <Icon name="check" size={10} /> : stop.standing === 'merging' ? <Spinner size="small" /> : at + 1}
      </span>
      <div className={t.body}>
        <p className={cx(s.pr, t.pr)}>
          <Name stop={stop} w={w} />
          {word !== null && <span className={s.state}>{word}</span>}
        </p>
        <Line stop={stop} before={before} target={target} w={w} />
      </div>
    </li>
  )
}

/** Its pull request by its repository's name, the one link to its host. */
function Name({ stop, w }: { stop: TrackStop; w: ChangeTrackText }) {
  const name = w.named(stop.name, stop.number)
  const mark = stop.host?.brand && <BrandMark brand={stop.host.brand} size={13} />
  const link = stop.host === undefined ? undefined : safeHref(stop.url)
  if (link === undefined || stop.host === undefined)
    return (
      <span className={s.prName}>
        {mark}
        <span className={t.name}>{name}</span>
      </span>
    )
  return (
    <a className={s.prLink} href={link} target="_blank" rel="noreferrer" aria-label={w.onHostLabel(stop.name, stop.number, stop.host.name)}>
      {mark}
      <span className={t.name}>{name}</span>
      <Icon name="external" size={10} />
    </a>
  )
}

/** Its one line: what stops it first, else how its checks stand, opening to them. */
function Line({ stop, before, target, w }: { stop: TrackStop; before: TrackStop | undefined; target: string; w: ChangeTrackText }) {
  const said = (tone: string, mark: ReactNode, words: string) => (
    <p className={cx(s.line, t.sentence, tone)}>
      <span className={s.mark}>{mark}</span>
      <span className={t.said}>{words}</span>
    </p>
  )
  switch (stop.standing) {
    case 'merged':
      return said(s.good, <Icon name="check" size={12} />, w.merged(target))
    case 'merging':
      return said(s.quiet, <Dash />, w.merging(target))
    case 'waiting':
      return said(s.quiet, <Dash />, before === undefined ? w.merging(target) : w.after(before.name))
    case 'refused':
      return said(s.bad, <Icon name="close" size={12} />, w.refused(stop.refused))
    default:
      if (stop.conflicts === true) return said(s.bad, <Icon name="close" size={12} />, w.conflicts(target))
      if (stop.checks === undefined) return null
      return <ChecksLine checks={stop.checks} t={{ ...w, checks: w.checksOf(stop.name) }} />
  }
}

function Dash() {
  return <span className={t.dash} aria-hidden="true" />
}
