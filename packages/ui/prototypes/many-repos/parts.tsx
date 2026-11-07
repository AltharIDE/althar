// Scrappy: what every direction reads off its repositories, and the few pieces they share: a repository by name, its line, the review, the files.
import { createContext, type ReactNode, useContext } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { BrandMark } from '../../src/foundations/Marks/Marks'
import { Brand } from '../../src/foundations/brands/brands'
import { CheckState } from '../../src/foundations/vocabulary'
import { cx } from '../../src/lib/cx'
import { Button } from '../../src/primitives/Button/Button'
import { type ChangeCheck, Checks } from '../../src/primitives/Checks/Checks'
import { Delta, FileChanges } from '../../src/primitives/FileChanges/FileChanges'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../src/primitives/Fold/Fold'
import { LiveDot } from '../../src/primitives/LiveDot/LiveDot'
import { Model, type ModelInfo } from '../../src/primitives/Model/Model'
import { Spinner } from '../../src/primitives/Spinner/Spinner'
import type { ChangeReview } from '../../src/outputs/ChangeSet/ChangeSet'
import cs from '../../src/outputs/ChangeSet/ChangeSet.module.css'
import { type Check, hostOf, type Repo, type Scenario, urlOf, newPullRequestOf } from './data'
import { type Direction, proto } from './state'
import p from './parts.module.css'

export { cs, p }

/** What a direction's card is handed: the repositories in the order they merge, and what the real Outputs gives every card. */
export interface CardProps {
  readonly scenario: Scenario
  readonly repos: readonly Repo[]
  readonly review?: ChangeReview
  /** Opens the whole diff over the window, on a file by its path in the worktree (its repository's folder first), or the first. */
  readonly onOpenFile?: (path?: string) => void
  readonly diffKey?: string
  readonly label: string
}

/** Where the page draws a card other than as the store has it: the side-by-side view, each state its own, presses changing nothing. */
export const Showing = createContext<{ direction: Direction; scenario: Scenario; repos: readonly Repo[]; live: false } | null>(null)

/** Presses change the page's repositories, except in the side-by-side view. */
export const useLive = () => useContext(Showing) === null

export const BRANDS = { gitlab: Brand.GitLab, github: Brand.GitHub } as const

/** A repository's pull request in words: engine !52; one with none, its name. */
export const prName = (repo: Repo) => (repo.number === null ? repo.slug : `${repo.slug} ${hostOf(repo).prefix}${repo.number}`)

const both = (n: number) => (n === 2 ? 'both' : `all ${n}`)
const andOf = (names: readonly string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/* ——— Where one repository stands. ——— */

export const failedOf = (repo: Repo) => repo.checks.filter((check) => check.state === 'failed')
const passedOf = (repo: Repo) => repo.checks.filter((check) => check.state === 'passed')

/** Said beside its name where it isn't simply open, as today's card says Draft: the rest its line says. */
export const wordOf = (repo: Repo): string | null => {
  switch (repo.state) {
    case 'draft':
      return 'Draft'
    case 'merged':
      return 'Merged'
    case 'merging':
      return 'Merging'
    case 'refused':
      return 'Not merged'
    case 'branch':
      return 'On its branch'
    default:
      return null
  }
}

export type Tone = 'good' | 'bad' | 'running' | 'quiet' | 'held'

/** Its one line: what stops it first, else how its checks stand. */
export const lineOf = (repo: Repo, repos: readonly Repo[] = []): { tone: Tone; said: string; checks: boolean } => {
  const host = hostOf(repo)
  if (repo.state === 'refused') return { tone: 'bad', said: `${host.name} refused: ${repo.refused ?? 'it couldn’t merge'}`, checks: false }
  if (repo.state === 'merging') return { tone: 'running', said: `Merging into main on ${host.name}`, checks: false }
  if (repo.state === 'waiting') {
    const before = repos[repos.findIndex((one) => one.slug === repo.slug) - 1]
    return { tone: 'quiet', said: before === undefined ? 'Merges next' : `Merges after ${before.slug}`, checks: false }
  }
  if (repo.state === 'merged') return { tone: 'good', said: 'Into main', checks: false }
  if (repo.state === 'branch' || !repo.connected)
    return { tone: 'held', said: `Its ${host.short} opens once ${host.name} is connected`, checks: false }
  if (repo.conflict !== undefined)
    return {
      tone: 'bad',
      said: `Conflicts with main in ${andOf(repo.conflict.map((path) => path.slice(path.lastIndexOf('/') + 1)))}`,
      checks: false,
    }
  const failed = failedOf(repo)
  if (failed.length > 0)
    return { tone: 'bad', said: failed.length === 1 ? `${failed[0]?.name ?? ''} failed` : `${failed.length} checks failed`, checks: true }
  if (repo.checks.length === 0) return { tone: 'quiet', said: 'No checks have run yet', checks: false }
  const passed = passedOf(repo).length
  if (passed < repo.checks.length) return { tone: 'running', said: `${passed} of ${repo.checks.length} checks passed`, checks: true }
  return { tone: 'good', said: repo.checks.length === 1 ? '1 check passed' : `${repo.checks.length} checks passed`, checks: true }
}

export const toneClass = (tone: Tone) =>
  tone === 'good' ? cs.good : tone === 'bad' ? cs.bad : tone === 'running' ? cs.running : tone === 'held' ? cs.held : cs.quiet

export const markOf = (tone: Tone, merging = false): ReactNode =>
  merging ? (
    <Spinner size="small" />
  ) : tone === 'good' ? (
    <Icon name="check" size={12} />
  ) : tone === 'bad' ? (
    <Icon name="close" size={12} />
  ) : tone === 'running' ? (
    <LiveDot ping />
  ) : tone === 'held' ? (
    <span className={cs.you} aria-hidden="true" />
  ) : (
    <span className={p.dash} aria-hidden="true" />
  )

const checkStateOf = (check: Check) =>
  check.state === 'failed'
    ? CheckState.Failed
    : check.state === 'running'
      ? CheckState.Running
      : check.state === 'queued'
        ? CheckState.Queued
        : CheckState.Passed

export const checksListOf = (repo: Repo): ChangeCheck[] =>
  repo.checks.map((check, at) => ({
    id: `${repo.slug}-${at}`,
    name: check.name,
    state: checkStateOf(check),
    ...(check.summary === undefined ? {} : { detail: check.summary }),
  }))

/** A repository's line, opening to its checks where it is about them. */
export function RepoLine({
  repo,
  repos,
  className,
  after,
}: {
  repo: Repo
  repos?: readonly Repo[]
  className?: string
  after?: ReactNode
}) {
  const { tone, said, checks } = lineOf(repo, repos)
  const mark = <span className={cs.mark}>{markOf(tone, repo.state === 'merging')}</span>
  if (!checks)
    return (
      <p className={cx(cs.line, toneClass(tone), p.sentence, className)}>
        {mark}
        <span className={cs.said}>{said}</span>
        {after}
      </p>
    )
  return (
    <Disclosure>
      <DisclosureTrigger>
        <button type="button" className={cx(cs.line, cs.opens, toneClass(tone), className)} aria-label={`${repo.slug}’s checks: ${said}`}>
          {mark}
          <span className={cs.said} title={said}>
            {said}
          </span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={cs.list}>
          <Checks checks={checksListOf(repo)} />
        </div>
      </Fold>
    </Disclosure>
  )
}

/** Its pull request by name, the one link to its host; with none, its name. */
export function RepoName({ repo, quiet = false }: { repo: Repo; quiet?: boolean }) {
  const host = hostOf(repo)
  const brand = <BrandMark brand={BRANDS[repo.host]} size={13} />
  if (repo.number === null)
    return (
      <span className={cx(cs.prName, quiet && p.quietName)}>
        {brand}
        <span>{repo.slug}</span>
      </span>
    )
  return (
    <a
      className={cx(cs.prLink, quiet && p.quietName)}
      href={urlOf(repo)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${repo.path} ${host.prefix}${repo.number} on ${host.name}`}
      onClick={(event) => event.stopPropagation()}
    >
      {brand}
      <span>{prName(repo)}</span>
      <Icon name="external" size={10} />
    </a>
  )
}

/** Its host's own page for a pull request from the branch: the fallback beside connecting, quiet. */
export function OnTheWeb({ repo, branch }: { repo: Repo; branch: string }) {
  return (
    <a
      className={cx(cs.page, p.web)}
      href={newPullRequestOf(repo, branch)}
      target="_blank"
      rel="noreferrer"
      title={`Open a ${hostOf(repo).noun} on ${hostOf(repo).name}, without Althar following it`}
    >
      {hostOf(repo).name}
      <Icon name="external" size={10} />
    </a>
  )
}

/* ——— The review, once for all of them. ——— */

export const TERRA: ModelInfo = {
  id: 'gpt-6.1-terra',
  name: 'GPT-6.1 Terra',
  short: 'GPT-6.1 Terra',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: [],
}

export const reviewOf = (props: CardProps): ChangeReview | undefined =>
  props.review ?? (props.scenario.review === null ? undefined : { state: CheckState.Passed, by: [TERRA] })

export function ReviewLine({ review }: { review: ChangeReview }) {
  const [mark, said, tone] =
    review.state === CheckState.Failed
      ? [<Icon key="m" name="close" size={12} />, 'Changes asked by', cs.bad]
      : review.state === CheckState.Passed
        ? [<Icon key="m" name="check" size={12} />, 'Reviewed by', cs.good]
        : [<LiveDot key="m" ping />, 'Being reviewed by', cs.running]
  return (
    <p className={cx(cs.line, tone)}>
      <span className={cs.mark}>{mark}</span>
      <span className={cs.said}>
        {said}{' '}
        {review.by.map((model) => (
          <Model key={model.id} model={model} className={cs.model} />
        ))}
      </span>
    </p>
  )
}

/* ——— What can be done: one press for all of them, and each one's own. ——— */

export interface Act {
  readonly key: string
  readonly label: string
  readonly run: () => void
  /** Violet, as today's card has accepting and connecting: the press the change waits on. Marking ready and asking the lead stay quiet. */
  readonly signal?: boolean
}

const still = (repos: readonly Repo[]) => repos.filter((repo) => repo.state !== 'merged')
export const isMerging = (repos: readonly Repo[]) => repos.some((repo) => repo.state === 'merging' || repo.state === 'waiting')

/** What stops the change as a whole, worst first: each a repository, with what the person does about it. */
export const blockersOf = (repos: readonly Repo[]): Array<{ repo: Repo; act: Act }> =>
  repos.flatMap((repo) => {
    if (repo.state === 'refused')
      return [
        { repo, act: { key: `rebase-${repo.slug}`, label: `Ask the lead to rebase ${repo.slug}`, run: () => proto.resolve(repo.slug) } },
      ]
    if (repo.state === 'merged') return []
    if (!repo.connected)
      return [
        { repo, act: { key: `connect-${repo.slug}`, label: `Connect ${hostOf(repo).name}`, run: () => proto.connect(), signal: true } },
      ]
    if (repo.conflict !== undefined)
      return [
        {
          repo,
          act: {
            key: `resolve-${repo.slug}`,
            label: `Ask the lead to resolve ${repo.slug}’s conflict`,
            run: () => proto.resolve(repo.slug),
          },
        },
      ]
    const [failed] = failedOf(repo)
    if (failed !== undefined)
      return [{ repo, act: { key: `fix-${repo.slug}`, label: `Ask the lead to fix ${failed.name}`, run: () => proto.fix(repo.slug) } }]
    return []
  })

/** Marks its drafts ready: both, all of them, or those named. */
export const markReadyOf = (repos: readonly Repo[]): Act | null => {
  const drafts = repos.filter((repo) => repo.state === 'draft')
  if (drafts.length === 0) return null
  const left = still(repos).filter((repo) => repo.connected)
  const label =
    drafts.length > 1 && drafts.length === left.length
      ? `Mark ${both(drafts.length)} ready`
      : `Mark ${andOf(drafts.map((repo) => repo.slug))} ready`
  return { key: 'ready', label, run: () => proto.markReady(drafts.map((repo) => repo.slug)) }
}

/** Accepts the change: merges what isn't merged yet, in order. */
export const mergeOf = (repos: readonly Repo[]): Act | null => {
  const left = still(repos)
  if (left.length === 0 || left.some((repo) => repo.state !== 'open' || !repo.connected)) return null
  const merged = repos.length - left.length
  const label =
    merged > 0
      ? `Merge ${andOf(left.map((repo) => repo.slug))}`
      : left.length === 1
        ? 'Accept and merge'
        : `Accept and merge ${both(left.length)}`
  return { key: 'merge', label, run: () => proto.merge(left.map((repo) => repo.slug)), signal: true }
}

/** The card's own row of actions: what stops it first, then marking its drafts ready, else accepting it. At most two. */
export const actsOf = (repos: readonly Repo[]): Act[] => {
  if (isMerging(repos)) return []
  const [first] = blockersOf(repos)
  const ready = markReadyOf(repos)
  const merge = first === undefined && ready === null ? mergeOf(repos) : null
  return [first?.act, ready, merge].filter((act): act is Act => act !== null && act !== undefined).slice(0, 2)
}

/** One repository's own action, beside it: what it needs, else merging it alone. */
export const ownActOf = (repo: Repo, repos: readonly Repo[]): Act | null => {
  if (isMerging(repos)) return null
  const blocker = blockersOf([repo])[0]
  if (blocker !== undefined)
    return {
      ...blocker.act,
      label:
        repo.state === 'refused'
          ? 'Ask the lead to rebase it'
          : repo.conflict !== undefined
            ? 'Ask the lead to resolve it'
            : failedOf(repo).length > 0
              ? 'Ask the lead to fix it'
              : blocker.act.label,
    }
  if (repo.state === 'draft') return { key: `ready-${repo.slug}`, label: 'Mark ready', run: () => proto.markReady([repo.slug]) }
  if (repo.state === 'open') return { key: `merge-${repo.slug}`, label: 'Merge', run: () => proto.merge([repo.slug]) }
  return null
}

/** Its row of buttons, the one to press first. */
export function Acts({ acts, live, className }: { acts: readonly Act[]; live: boolean; className?: string }) {
  if (acts.length === 0) return null
  return (
    <div className={cx(cs.actions, className)}>
      {acts.map((act) => (
        <Button key={act.key} variant={act.signal === true ? 'signal' : 'default'} onClick={live ? act.run : undefined}>
          {act.label}
        </Button>
      ))}
    </div>
  )
}

/* ——— How big it is, the way into the diff, and its files, under the repository each is in. ——— */

export const totalOf = (repos: readonly Repo[]) => {
  const files = repos.flatMap((repo) => repo.files)
  return { files: files.length, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) }
}
export const filesWord = (n: number) => (n === 1 ? '1 file' : `${n} files`)

/** Its size and the one way into the whole diff. */
export function Size({
  repos,
  onOpenFile,
  diffKey,
  label = 'Review the diff',
}: {
  repos: readonly Repo[]
  onOpenFile?: (path?: string) => void
  diffKey?: string
  label?: string
}) {
  const total = totalOf(repos)
  return (
    <div className={cs.size}>
      <span className={cs.count}>{filesWord(total.files)}</span>
      <Delta add={total.add} del={total.del} />
      {onOpenFile !== undefined && (
        <Button
          className={cs.diff}
          variant="quiet"
          size="small"
          kbd={diffKey}
          onClick={() => onOpenFile(repos.length === 1 ? `${repos[0]?.slug ?? ''}/${repos[0]?.files[0]?.path ?? ''}` : undefined)}
        >
          {label}
        </Button>
      )}
    </div>
  )
}

/** One repository's files, by their paths in it, on the scale given; each opening its diff. */
export function RepoFiles({ repo, most, onOpenFile }: { repo: Repo; most: number; onOpenFile?: (path?: string) => void }) {
  return (
    <FileChanges
      files={repo.files}
      most={most}
      {...(onOpenFile === undefined ? {} : { onOpen: (path: string) => onOpenFile(`${repo.slug}/${path}`) })}
      text={{ open: (path) => `Open the diff of ${repo.slug}/${path}` }}
    />
  )
}

export const mostOf = (repos: readonly Repo[]) => Math.max(1, ...repos.flatMap((repo) => repo.files.map((f) => f.add + f.del)))

/** Every repository's files under its name, which opens the diff on its first. */
export function GroupedFiles({ repos, onOpenFile }: { repos: readonly Repo[]; onOpenFile?: (path?: string) => void }) {
  const most = mostOf(repos)
  return (
    <div className={p.byRepo}>
      {repos.map((repo) => (
        <div key={repo.slug} className={cs.group}>
          <p className={p.repoHeading}>
            <button
              type="button"
              className={p.repoHeadingButton}
              onClick={() => onOpenFile?.(`${repo.slug}/${repo.files[0]?.path ?? ''}`)}
              aria-label={`Open ${repo.slug}’s diff`}
            >
              {repo.slug}
            </button>
          </p>
          <RepoFiles repo={repo} most={most} onOpenFile={onOpenFile} />
        </div>
      ))}
    </div>
  )
}
