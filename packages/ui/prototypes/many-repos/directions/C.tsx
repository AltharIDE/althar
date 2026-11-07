// Scrappy: C · the change as an ordered merge, its files a tab per repository. Each repository is a numbered stop on one track, in the order they merge, what the others build on first; merged stops fill in as they go, and one refused stops the line there. One split button does the next thing, its menu each repository's own. Under it, the files of all of them or of one.
import { useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import { cx } from '../../../src/lib/cx'
import { Button } from '../../../src/primitives/Button/Button'
import { Menu, MenuItem } from '../../../src/primitives/Menu/Menu'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import { SplitButton } from '../../../src/primitives/SplitButton/SplitButton'
import type { Repo } from '../data'
import {
  type Act,
  type CardProps,
  actsOf,
  cs,
  GroupedFiles,
  lineOf,
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
  useLive,
  wordOf,
} from '../parts'

/** How its stop is drawn: filled once merged, red where it is stopped, dashed while a draft or not yet on its host. */
const stopOf = (repo: Repo) => {
  if (repo.state === 'merged') return p.stopMerged
  if (repo.state === 'merging') return p.stopMerging
  const { tone } = lineOf(repo)
  if (tone === 'bad') return p.stopBad
  if (tone === 'held') return p.stopHeld
  if (repo.state === 'draft') return p.stopDraft
  return p.stopOpen
}

/** Each repository's own action in the menu, by its name. */
const menuActsOf = (repos: readonly Repo[], main: Act | undefined): Act[] =>
  repos.flatMap((repo) => {
    const own = ownActOf(repo, repos)
    if (own === null || own.key === main?.key) return []
    const label =
      own.label === 'Merge'
        ? `Merge ${repo.slug} alone`
        : own.label === 'Mark ready'
          ? `Mark ${repo.slug} ready`
          : own.label.endsWith(' it')
            ? `${own.label.slice(0, -3)} ${repo.slug}`
            : own.label
    return [{ ...own, label }]
  })

export function CardC(props: CardProps) {
  const { repos, scenario, onOpenFile, diffKey, label } = props
  const live = useLive()
  const review = reviewOf(props)
  const acts = actsOf(repos)
  const [main, ...rest] = acts
  const more = [...rest, ...menuActsOf(repos, main)].filter((act, at, all) => all.findIndex((one) => one.label === act.label) === at)
  const [tab, setTab] = useState<string>('all')
  const shown = tab === 'all' ? repos : repos.filter((repo) => repo.slug === tab)
  return (
    <article className={cs.change} aria-label={label}>
      <div className={cx(cs.decide, actsOf(repos).length > 0 && cs.acting)}>
        <div className={cs.facts}>
          <ol className={p.track} aria-label="In the order they merge">
            {repos.map((repo, at) => {
              const word = wordOf(repo)
              return (
                <li
                  key={repo.slug}
                  className={cx(
                    p.stop,
                    stopOf(repo),
                    // The track through a merged stop is done.
                    repo.state === 'merged' ? p.linkDone : null,
                  )}
                >
                  <span className={p.node} aria-hidden="true">
                    {repo.state === 'merged' ? (
                      <Icon name="check" size={10} />
                    ) : repo.state === 'merging' ? (
                      <Spinner size="small" />
                    ) : (
                      at + 1
                    )}
                  </span>
                  <div className={p.stopBody}>
                    <p className={p.rowHead}>
                      <RepoName repo={repo} />
                      {word !== null && <span className={cs.state}>{word}</span>}
                    </p>
                    <RepoLine
                      repo={repo}
                      repos={repos}
                      {...(repo.number === null ? { after: <OnTheWeb repo={repo} branch={scenario.branch} /> } : {})}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
          {review !== undefined && (
            <div className={cs.lines}>
              <ReviewLine review={review} />
            </div>
          )}
        </div>
        {main !== undefined && (
          <div className={cs.actions}>
            {more.length === 0 ? (
              <Button variant={main.signal === true ? 'signal' : 'default'} onClick={live ? main.run : undefined}>
                {main.label}
              </Button>
            ) : (
              <SplitButton
                variant={main.signal === true ? 'signal' : 'default'}
                className={p.split}
                moreLabel="Other ways"
                onClick={live ? main.run : undefined}
                menu={(trigger) => (
                  <Menu trigger={trigger} label="Other ways" align="end">
                    {more.map((act) => (
                      <MenuItem key={act.key} onSelect={live ? act.run : () => undefined}>
                        {act.label}
                      </MenuItem>
                    ))}
                  </Menu>
                )}
              >
                {main.label}
              </SplitButton>
            )}
          </div>
        )}
      </div>
      <div className={cs.files}>
        <Segmented<string>
          label="Files of"
          value={tab}
          onChange={setTab}
          className={p.tabs}
          options={[{ value: 'all', label: 'All' }, ...repos.map((repo) => ({ value: repo.slug, label: repo.slug }))]}
        />
        <Size repos={shown} onOpenFile={onOpenFile} diffKey={tab === 'all' ? diffKey : undefined} />
        {tab === 'all' ? (
          <GroupedFiles repos={repos} onOpenFile={onOpenFile} />
        ) : (
          shown[0] && <RepoFiles repo={shown[0]} most={mostOf(repos)} onOpenFile={onOpenFile} />
        )}
      </div>
    </article>
  )
}
