import { useState } from 'react'

import { Button, Popover, Segmented, Switch } from '@althar/ui'

import { type Artifact, boardCount, type Kept, REPOS } from '../artifacts'
import { commitOf, live, useLive } from '../live'
import { Glyph } from './Glyph'
import s from './parts.module.css'

/*
 * Where an artifact lives: in Althar only, as it starts, or saved to a
 * folder in a repository (the project's own, or one the team keeps for
 * designs), so it's in git with everything else, reviewed in a pull request
 * and read by people who never open Althar. Saving is shown at once; its
 * commit follows. Comments and pins stay in Althar either way.
 */

const FILE: Readonly<Record<Artifact['kind'], string>> = { design: '', document: '.md', diagram: '.mmd', chart: '.svg' }

/** Where an artifact goes in a repository unless the person says otherwise. */
const pathIn = (artifact: Artifact, repo: string) => {
  const folder = REPOS.find((one) => one.name === repo)?.folder ?? ''
  if (artifact.kind === 'design') return `${folder}${artifact.name}/`
  return `${repo === 'kiln' ? 'docs/' : ''}${artifact.name}${FILE[artifact.kind]}`
}

type How = Kept['how']
const howsFor = (artifact: Artifact, repo: string): ReadonlyArray<{ value: How; label: string }> =>
  repo === 'kiln'
    ? artifact.task !== null
      ? [
          { value: 'task', label: 'With the task’s change' },
          { value: 'pr', label: 'A pull request of its own' },
        ]
      : [
          { value: 'pr', label: 'A pull request of its own' },
          { value: 'main', label: 'Straight to main' },
        ]
    : [
        { value: 'main', label: 'Straight to main' },
        { value: 'pr', label: 'A pull request of its own' },
      ]

const branchOf = (artifact: Artifact) => `althar/${(artifact.task ?? artifact.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** Where it is, in a list's line: `design/gift-a-class/` in the project's own repository, `kiln-design/class-page/` in another. */
export function Where({ artifact, className }: { artifact: Artifact; className?: string }) {
  useLive()
  const kept = live.keptOf(artifact)
  if (kept === null) return null
  return (
    <span className={`${s.where} ${className ?? ''}`} title={`In ${kept.repo}, at ${commitOf(artifact.id, kept.version)}`}>
      <Glyph name="repo" size={11} />
      <span className={s.wherePath}>{kept.repo === REPOS[0]?.name ? kept.path : `${kept.repo}/${kept.path}`}</span>
    </span>
  )
}

export function Keep({
  artifact,
  open,
  onOpenChange,
  start,
}: {
  artifact: Artifact
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Where the popover starts, for a moment that opens it with a repository chosen. */
  start?: 'althar' | 'repo'
}) {
  const world = useLive()
  const kept = live.keptOf(artifact)
  const version = live.version(artifact)
  const committing = world.committing.includes(artifact.id)
  const behind = kept !== null && kept.version < version
  return (
    <Popover
      label={`Where ${artifact.title} lives`}
      width={380}
      align="end"
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      trigger={
        <button type="button" className={s.keepHead} data-kept={kept !== null || undefined}>
          <Glyph name="repo" size={13} />
          {kept === null ? (
            <span>Save to repo</span>
          ) : (
            // Its folder's own name; the whole path is in its popover.
            <span className={s.keepPath} title={`In ${kept.repo}/${kept.path}`}>
              {kept.path.endsWith('/')
                ? `${kept.path.split('/').filter(Boolean).at(-1) ?? ''}/`
                : (kept.path.split('/').at(-1) ?? kept.path)}
            </span>
          )}
          {committing && <span className={s.keepBusy} aria-label="Committing" />}
          {behind && !committing && <span className={s.keepBehind}>v{version} not in git</span>}
        </button>
      }
    >
      <KeepForm artifact={artifact} kept={kept} version={version} start={start} onDone={() => onOpenChange?.(false)} />
    </Popover>
  )
}

function KeepForm({
  artifact,
  kept,
  version,
  start,
  onDone,
}: {
  artifact: Artifact
  kept: Kept | null
  version: number
  start?: 'althar' | 'repo'
  onDone: () => void
}) {
  const [where, setWhere] = useState<'althar' | 'repo'>(kept !== null ? 'repo' : (start ?? 'althar'))
  const [repo, setRepo] = useState(kept?.repo ?? 'kiln')
  const [path, setPath] = useState(kept?.path ?? pathIn(artifact, repo))
  const [how, setHow] = useState<How>(kept?.how ?? howsFor(artifact, repo)[0]?.value ?? 'pr')
  const [follow, setFollow] = useState(kept?.follow ?? true)
  const hows = howsFor(artifact, repo)
  const main = REPOS.find((one) => one.name === repo)?.main ?? 'main'
  const design = artifact.kind === 'design'
  const changed = kept === null || kept.repo !== repo || kept.path !== path || kept.how !== how || kept.follow !== follow
  const save = () => {
    live.save(artifact, { repo, path, how, follow, version })
    onDone()
  }
  const pickRepo = (next: string) => {
    // A path still as Althar chose it follows the repository; one the person wrote stays.
    if (path === pathIn(artifact, repo)) setPath(pathIn(artifact, next))
    if (!howsFor(artifact, next).some((one) => one.value === how)) setHow(howsFor(artifact, next)[0]?.value ?? 'pr')
    setRepo(next)
  }
  return (
    <div className={s.share}>
      <div className={s.shareTitle}>Where {artifact.title} lives</div>
      <Segmented
        label="Where it lives"
        value={where}
        onChange={setWhere}
        options={[
          { value: 'althar', label: 'Only in Althar' },
          { value: 'repo', label: 'In a repository' },
        ]}
      />
      {where === 'althar' ? (
        <>
          <p className={s.shareLine}>
            {kept === null
              ? 'Its versions stay with the task. People see it when you share it; nobody gets it from git.'
              : `What’s in ${kept.repo} stays in its history. New versions stay in Althar.`}
          </p>
          {kept !== null && (
            <div className={s.keepEnd}>
              <Button
                size="small"
                onClick={() => {
                  live.save(artifact, null)
                  onDone()
                }}
              >
                Stop saving to {kept.repo}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {kept !== null && (
            <div className={s.keptNow}>
              <Glyph name="commit" size={13} />
              <span>
                v{kept.version} is in {kept.repo} at <code>{commitOf(artifact.id, kept.version)}</code>
              </span>
            </div>
          )}
          <div className={s.keepField}>
            <span className={s.keepLabel}>Repository</span>
            <Segmented
              label="Repository"
              value={repo}
              onChange={pickRepo}
              options={REPOS.map((one) => ({ value: one.name, label: one.name, tooltip: { label: one.what } }))}
            />
          </div>
          <label className={s.keepField}>
            <span className={s.keepLabel}>{design ? 'Folder' : 'File'}</span>
            <input className={s.keepInput} value={path} spellCheck={false} onChange={(event) => setPath(event.target.value)} />
          </label>
          {design && (
            <ul className={s.keepFiles} aria-label="What goes in it">
              <li>
                <code>canvas.json</code>
                <span>
                  {artifact.pages.length} pages, {boardCount(artifact)} boards, their sizes
                </span>
              </li>
              <li>
                <code>boards/</code>
                <span>each board’s page</span>
              </li>
              <li>
                <code>README.md</code>
                <span>every board as a picture</span>
              </li>
            </ul>
          )}
          <div className={s.keepField}>
            <span className={s.keepLabel}>How it goes in</span>
            <Segmented label="How it goes in" value={how} onChange={setHow} options={hows} />
          </div>
          <p className={s.shareLine}>
            {how === 'task'
              ? `Committed on ${branchOf(artifact)}, so it’s reviewed and merged with the task.`
              : how === 'pr'
                ? `On a branch of its own, with a pull request on ${repo}.`
                : `Committed to ${main} on ${repo}.`}
          </p>
          <div className={s.shareRow}>
            <span className={s.shareRowWords}>
              <span id="keep-follow">Commit each new version</span>
              <span className={s.keepSub}>{follow ? 'As the lead makes it' : 'Only when you save'}</span>
            </span>
            <Switch checked={follow} onChange={setFollow} labelledBy="keep-follow" />
          </div>
          <p className={s.keepAside}>Comments and pins stay in Althar.</p>
          <div className={s.keepEnd}>
            {kept !== null && !changed && kept.version < version ? (
              <Button variant="ink" size="small" onClick={save}>
                Commit v{version}
              </Button>
            ) : (
              <Button variant="ink" size="small" disabled={!changed || path.trim() === ''} onClick={save}>
                {kept === null ? `Save to ${repo}` : 'Save changes'}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
