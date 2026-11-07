// Scrappy: A · one change, its repositories as rows. Each row its pull request, where it stands, and its line; its own action on hover. One press for all of them under the rows, and the files under the repository each is in.
import { Button } from '../../../src/primitives/Button/Button'
import { cx } from '../../../src/lib/cx'
import {
  type CardProps,
  Acts,
  actsOf,
  cs,
  GroupedFiles,
  OnTheWeb,
  ownActOf,
  p,
  RepoLine,
  RepoName,
  ReviewLine,
  reviewOf,
  Size,
  useLive,
  wordOf,
} from '../parts'

export function CardA(props: CardProps) {
  const { repos, scenario, onOpenFile, diffKey, label } = props
  const live = useLive()
  const review = reviewOf(props)
  const acts = actsOf(repos)
  return (
    <article className={cs.change} aria-label={label}>
      <div className={cs.decide}>
        <div className={cs.facts}>
          <ul className={p.rows}>
            {repos.map((repo) => {
              const word = wordOf(repo)
              const own = ownActOf(repo, repos)
              return (
                <li key={repo.slug} className={p.row}>
                  <p className={p.rowHead}>
                    <RepoName repo={repo} />
                    {word !== null && <span className={cx(cs.state, repo.state === 'refused' && p.bad)}>{word}</span>}
                    {own !== null && (
                      <Button className={p.rowAct} variant="quiet" size="small" onClick={live ? own.run : undefined}>
                        {own.label}
                      </Button>
                    )}
                  </p>
                  {repo.state !== 'merged' && (
                    <RepoLine
                      repo={repo}
                      repos={repos}
                      className={p.under}
                      {...(repo.number === null ? { after: <OnTheWeb repo={repo} branch={scenario.branch} /> } : {})}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          {review !== undefined && (
            <div className={cs.lines}>
              <ReviewLine review={review} />
            </div>
          )}
        </div>
        <Acts acts={acts} live={live} />
      </div>
      <div className={cs.files}>
        <Size repos={repos} onOpenFile={onOpenFile} diffKey={diffKey} />
        <GroupedFiles repos={repos} onOpenFile={onOpenFile} />
      </div>
    </article>
  )
}
