import { type ReactNode, useState } from 'react'

import { Button, Menu, MenuRadioGroup, MenuRadioItem, Popover } from '@althar/ui'

import { type Artifact, type Kept, REPOS } from '../artifacts'
import { commitOf, live, useLive } from '../live'
import { nameFor, pathOf, type Place, placeOfPath, suggestionsFor } from '../repos'
import { type Picker, useLab } from '../state'
import { Glyph } from './Glyph'
import k from './keep.module.css'
import s from './parts.module.css'
import { Columns, PathPicker, type PickerProps, Suggested, Tree } from './Pickers'

/*
 * Save to repo: where an artifact lives in git. In Althar only, as it
 * starts, or in a folder of a repository (the project's own, or one the team
 * keeps for designs), so it's reviewed in a pull request and read by people
 * who never open Althar. The lab tries four ways to pick the folder (E):
 * a path whose every part is a menu, the repository as a tree, its folders
 * in columns, and Althar's suggestions with a find for anywhere else. Around
 * each, the same: how it goes in, when it's committed, and Save. Saving is
 * shown at once; its commit follows. Comments and pins stay in Althar.
 */

type How = Kept['how']
const HOW: Readonly<Record<How, { readonly short: string; readonly label: string }>> = {
  task: { short: 'With the task', label: 'With the task’s change' },
  pr: { short: 'Own pull request', label: 'A pull request of its own' },
  main: { short: 'Straight to main', label: 'Straight to main' },
}
const howsFor = (artifact: Artifact, repo: string): ReadonlyArray<How> =>
  repo === 'kiln' ? (artifact.task !== null ? ['task', 'pr'] : ['pr', 'main']) : ['main', 'pr']

const branchOf = (artifact: Artifact) => `althar/${(artifact.task ?? artifact.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

const WIDTH: Readonly<Record<Picker, number>> = { path: 420, tree: 420, columns: 800, suggested: 420 }

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

export function Keep({ artifact, open, onOpenChange }: { artifact: Artifact; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const world = useLive()
  const { k: picker } = useLab()
  const kept = live.keptOf(artifact)
  const version = live.version(artifact)
  const committing = world.committing.includes(artifact.id)
  const behind = kept !== null && kept.version < version
  return (
    <Popover
      label={`Where ${artifact.title} lives`}
      width={WIDTH[picker]}
      align="end"
      padded={false}
      initialFocus="panel"
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
      {/* Keyed on the picker: another one starts from where the artifact is, or Althar's first suggestion. */}
      <KeepForm key={picker} picker={picker} artifact={artifact} kept={kept} version={version} onDone={() => onOpenChange?.(false)} />
    </Popover>
  )
}

/** Where a new one goes unless the person says otherwise: Althar's first suggestion. */
const placeFor = (artifact: Artifact, kept: Kept | null): Place => {
  if (kept !== null) return placeOfPath(kept.repo, kept.path)
  const first = suggestionsFor(artifact)[0]
  return { repo: first?.repo ?? 'kiln', folder: first?.folder ?? '', name: nameFor(artifact) }
}

function KeepForm({
  picker,
  artifact,
  kept,
  version,
  onDone,
}: {
  picker: Picker
  artifact: Artifact
  kept: Kept | null
  version: number
  onDone: () => void
}) {
  const [place, setPlace] = useState<Place>(() => placeFor(artifact, kept))
  const [how, setHow] = useState<How>(kept?.how ?? howsFor(artifact, place.repo)[0] ?? 'pr')
  const [follow, setFollow] = useState(kept?.follow ?? true)
  const path = pathOf(place, artifact)
  const hows = howsFor(artifact, place.repo)
  const main = REPOS.find((one) => one.name === place.repo)?.main ?? 'main'
  const changed = kept === null || kept.repo !== place.repo || kept.path !== path || kept.how !== how || kept.follow !== follow
  const onPlace = (next: Place) => {
    // Another repository takes its own ways in: what fits it first, unless the one chosen fits it too.
    if (next.repo !== place.repo && !howsFor(artifact, next.repo).includes(how)) setHow(howsFor(artifact, next.repo)[0] ?? 'pr')
    setPlace(next)
  }
  const save = () => {
    live.save(artifact, { repo: place.repo, path, how, follow, version })
    onDone()
  }
  const Picked: (props: PickerProps) => ReactNode = { path: PathPicker, tree: Tree, columns: Columns, suggested: Suggested }[picker]
  const saved = kept === null ? null : placeOfPath(kept.repo, kept.path)
  return (
    <div className={k.keep} data-picker={picker}>
      <div className={k.head}>
        <span className={k.headWords}>
          <span className={k.title}>{kept === null ? `Save ${artifact.title} to a repo` : `${artifact.title} in git`}</span>
          {kept !== null && (
            <span className={k.now}>
              <Glyph name="commit" size={12} />v{kept.version} in {kept.repo} at <code>{commitOf(artifact.id, kept.version)}</code>
            </span>
          )}
        </span>
        {kept !== null && (
          <button
            type="button"
            className={k.stop}
            onClick={() => {
              live.save(artifact, null)
              onDone()
            }}
          >
            Stop saving
          </button>
        )}
      </div>
      <Picked artifact={artifact} place={place} onPlace={onPlace} saved={saved} />
      <div className={k.foot}>
        <Menu
          label="How it goes in"
          width={300}
          trigger={
            <button type="button" className={k.footMenu}>
              <Glyph name="commit" size={13} />
              {HOW[how].short}
              <Glyph name="down" size={10} />
            </button>
          }
        >
          <MenuRadioGroup label="How it goes in" value={how} onChange={(value) => setHow(value as How)}>
            {hows.map((one) => (
              <MenuRadioItem
                key={one}
                value={one}
                description={
                  one === 'task'
                    ? `Committed on ${branchOf(artifact)}, reviewed and merged with the task`
                    : one === 'pr'
                      ? `On a branch of its own, with a pull request on ${place.repo}`
                      : `Committed to ${main} on ${place.repo}`
                }
              >
                {HOW[one].label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
        <Menu
          label="When it’s committed"
          width={260}
          trigger={
            <button type="button" className={k.footMenu}>
              {follow ? 'Every version' : 'When you save'}
              <Glyph name="down" size={10} />
            </button>
          }
        >
          <MenuRadioGroup label="When it’s committed" value={follow ? 'each' : 'save'} onChange={(value) => setFollow(value === 'each')}>
            <MenuRadioItem value="each" description="As the lead makes each one">
              Every version
            </MenuRadioItem>
            <MenuRadioItem value="save" description="Only the version you save">
              When you save
            </MenuRadioItem>
          </MenuRadioGroup>
        </Menu>
        <span className={k.footGap} />
        {kept !== null && !changed && kept.version < version ? (
          <Button variant="ink" size="small" onClick={save}>
            Commit v{version}
          </Button>
        ) : (
          <Button variant="ink" size="small" disabled={!changed || place.name.trim() === ''} onClick={save}>
            {kept === null ? `Save to ${place.repo}` : kept.repo !== place.repo || kept.path !== path ? 'Move it' : 'Save changes'}
          </Button>
        )}
      </div>
    </div>
  )
}
