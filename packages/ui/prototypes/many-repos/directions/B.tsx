// Scrappy: B · a section per repository, under a summary. The summary says where the whole change stands and which repository holds it, with the review and the one press; each section is a whole card's worth for its repository, folded, those holding it open.
import { cx } from '../../../src/lib/cx'
import { Button } from '../../../src/primitives/Button/Button'
import { Delta } from '../../../src/primitives/FileChanges/FileChanges'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../../src/primitives/Fold/Fold'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import type { Repo } from '../data'
import {
  type CardProps,
  Acts,
  actsOf,
  blockersOf,
  cs,
  isMerging,
  lineOf,
  markOf,
  mostOf,
  OnTheWeb,
  ownActOf,
  p,
  RepoFiles,
  RepoLine,
  RepoName,
  ReviewLine,
  reviewOf,
  Size,
  toneClass,
  useLive,
  wordOf,
} from '../parts'

const names = (repos: readonly Repo[]) => {
  const list = repos.map((repo) => repo.slug)
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1) ?? ''}`
}

/** Where the whole change stands, in a few words, and what holds it: by repository. */
const overallOf = (repos: readonly Repo[]) => {
  const merged = repos.filter((repo) => repo.state === 'merged')
  const refused = repos.find((repo) => repo.state === 'refused')
  if (merged.length === repos.length) return { tone: 'good' as const, said: 'Merged' }
  if (isMerging(repos)) return { tone: 'running' as const, said: 'Merging in order', merging: true }
  if (refused !== undefined) return { tone: 'bad' as const, said: `Stopped at ${refused.slug}` }
  const blocked = blockersOf(repos).map((one) => one.repo)
  if (blocked.length > 0)
    return blocked.every((repo) => !repo.connected)
      ? { tone: 'held' as const, said: `Waiting on ${names(blocked)}` }
      : { tone: 'bad' as const, said: `Held by ${names(blocked)}` }
  const drafts = repos.filter((repo) => repo.state === 'draft')
  if (drafts.length === repos.length - merged.length) return { tone: 'quiet' as const, said: drafts.length > 1 ? 'Drafts' : 'Draft' }
  if (drafts.length > 0) return { tone: 'quiet' as const, said: `Waiting on ${names(drafts)}`, draft: true }
  const running = repos.filter((repo) => lineOf(repo).tone === 'running')
  if (running.length > 0) return { tone: 'running' as const, said: `Checks running in ${names(running)}` }
  const left = repos.filter((repo) => repo.state !== 'merged')
  return { tone: 'good' as const, said: merged.length > 0 ? `${names(merged)} merged, ${names(left)} ready` : 'Ready to accept' }
}

function Section({
  repo,
  repos,
  open,
  onOpenFile,
  branch,
  most,
}: {
  repo: Repo
  repos: readonly Repo[]
  open: boolean
  onOpenFile?: (path?: string) => void
  branch: string
  most: number
}) {
  const live = useLive()
  const word = wordOf(repo)
  const { tone } = lineOf(repo)
  // Its own press, unless the summary's is already that one.
  const own = [ownActOf(repo, repos)].find((act) => act !== null && !actsOf(repos).some((one) => one.key === act.key)) ?? null
  const add = repo.files.reduce((n, f) => n + f.add, 0)
  const del = repo.files.reduce((n, f) => n + f.del, 0)
  return (
    <Disclosure defaultOpen={open}>
      <section className={p.section}>
        <DisclosureTrigger>
          <button type="button" className={p.sectionHead} aria-label={`${repo.slug}: ${lineOf(repo).said}`}>
            <Caret />
            <span className={p.sectionName}>
              <RepoName repo={repo} />
              {word !== null && <span className={cs.state}>{word}</span>}
            </span>
            <Delta add={add} del={del} />
            <span className={cx(p.sectionMark, toneClass(tone))}>
              {repo.state === 'merging' ? <Spinner size="small" /> : tone === 'running' ? <LiveDot ping /> : markOf(tone)}
            </span>
          </button>
        </DisclosureTrigger>
        <Fold bleed={false}>
          <div className={p.sectionBody}>
            <RepoLine repo={repo} repos={repos} {...(repo.number === null ? { after: <OnTheWeb repo={repo} branch={branch} /> } : {})} />
            <RepoFiles repo={repo} most={most} onOpenFile={onOpenFile} />
            <div className={p.sectionActs}>
              {own !== null && (
                <Button size="small" onClick={live ? own.run : undefined}>
                  {own.label}
                </Button>
              )}
              <Button
                size="small"
                variant="quiet"
                className={p.end}
                onClick={() => onOpenFile?.(`${repo.slug}/${repo.files[0]?.path ?? ''}`)}
              >
                {`Review ${repo.slug}’s diff`}
              </Button>
            </div>
          </div>
        </Fold>
      </section>
    </Disclosure>
  )
}

export function CardB(props: CardProps) {
  const { repos, scenario, onOpenFile, diffKey, label } = props
  const live = useLive()
  const review = reviewOf(props)
  const overall = overallOf(repos)
  const held = new Set(blockersOf(repos).map((one) => one.repo.slug))
  const most = mostOf(repos)
  return (
    <article className={cs.change} aria-label={label}>
      <div className={cx(cs.decide, actsOf(repos).length > 0 && cs.acting)}>
        <div className={cs.facts}>
          <p className={cx(p.overall, toneClass(overall.tone))}>
            <span className={cs.mark}>{markOf(overall.tone, 'merging' in overall)}</span>
            <span>{overall.said}</span>
          </p>
          {review !== undefined && (
            <div className={cs.lines}>
              <ReviewLine review={review} />
            </div>
          )}
        </div>
        <Acts acts={actsOf(repos)} live={live} />
      </div>
      <div className={p.sections}>
        {repos.map((repo) => (
          <Section
            key={`${scenario.key}-${repo.slug}`}
            repo={repo}
            repos={repos}
            open={held.has(repo.slug)}
            onOpenFile={onOpenFile}
            branch={scenario.branch}
            most={most}
          />
        ))}
      </div>
      <div className={cx(cs.files, p.foot)}>
        <Size repos={repos} onOpenFile={onOpenFile} diffKey={diffKey} label="Review the whole diff" />
      </div>
    </article>
  )
}
