import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useId, useState } from 'react'

import { Button, Menu, MenuRadioGroup, MenuRadioItem, Popover, Room, Switch } from '@althar/ui'

import { type Artifact, type Home, type Kept, REPOS } from '../artifacts'
import { KILN } from '../data'
import { commitOf, live, useLive } from '../live'
import { nameFor, pathOf, type Place, placeOfPath, suggestionsFor } from '../repos'
import { type Picker, useLab } from '../state'
import { Glyph } from './Glyph'
import k from './keep.module.css'
import s from './parts.module.css'
import { Columns, NameInput, PathPicker, type PickerProps, Suggested, Trail, Tree } from './Pickers'

/*
 * Save to repo: where an artifact lives in git. In Althar only, as it
 * starts, or in a folder of a repository (the project's own, or one the team
 * keeps for designs), so it's reviewed in a pull request and read by people
 * who never open Althar. The lab tries four ways to pick the folder (E):
 * a path whose every part is a menu, the repository as a tree, its folders
 * in columns, and Althar's suggestions with a find for anywhere else; around
 * each, how it goes in, when it's committed, and Save. Then the one place
 * (E5–E7): the project's place for artifacts, a setting the first save
 * makes, with the tree for somewhere else, and how it goes in the setting's.
 * Saving is shown at once; its commit follows. Comments and pins stay in
 * Althar.
 */

type How = Kept['how']
const HOW: Readonly<Record<How, { readonly short: string; readonly label: string }>> = {
  pr: { short: 'Own pull request', label: 'A pull request of its own' },
  main: { short: 'Straight to main', label: 'Straight to main' },
}
/** The project's own code takes a pull request first; the team's designs, a commit to main. */
const howsFor = (repo: string): ReadonlyArray<How> => (repo === 'kiln' ? ['pr', 'main'] : ['main', 'pr'])

const WIDTH: Readonly<Record<Picker, number>> = { path: 420, tree: 420, columns: 800, suggested: 420, place: 420 }

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
      {picker === 'place' ? (
        <PlaceForm key={picker} artifact={artifact} kept={kept} version={version} onDone={() => onOpenChange?.(false)} />
      ) : (
        <KeepForm key={picker} picker={picker} artifact={artifact} kept={kept} version={version} onDone={() => onOpenChange?.(false)} />
      )}
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
  picker: Exclude<Picker, 'place'>
  artifact: Artifact
  kept: Kept | null
  version: number
  onDone: () => void
}) {
  const [place, setPlace] = useState<Place>(() => placeFor(artifact, kept))
  const [how, setHow] = useState<How>(kept?.how ?? howsFor(place.repo)[0] ?? 'pr')
  const [follow, setFollow] = useState(kept?.follow ?? true)
  const path = pathOf(place, artifact)
  const hows = howsFor(place.repo)
  const main = REPOS.find((one) => one.name === place.repo)?.main ?? 'main'
  const changed = kept === null || kept.repo !== place.repo || kept.path !== path || kept.how !== how || kept.follow !== follow
  const onPlace = (next: Place) => {
    // Another repository takes its own ways in: what fits it first, unless the one chosen fits it too.
    if (next.repo !== place.repo && !howsFor(next.repo).includes(how)) setHow(howsFor(next.repo)[0] ?? 'pr')
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
      <Head artifact={artifact} kept={kept} title={`Save ${artifact.title} to a repo`} onDone={onDone} />
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
                  one === 'pr' ? `On a branch of its own, with a pull request on ${place.repo}` : `Committed to ${main} on ${place.repo}`
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

/** What it is, or where it is in git, with Stop saving once it's there. */
function Head({ artifact, kept, title, onDone }: { artifact: Artifact; kept: Kept | null; title: string; onDone: () => void }) {
  return (
    <div className={k.head}>
      <span className={k.headWords}>
        <span className={k.title}>{kept === null ? title : `${artifact.title} in git`}</span>
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
  )
}

/* ——— V. One place: the project's, with the tree for somewhere else ——— */

/** Where the project has no place for artifacts yet, Althar's pick: its first suggestion, and how that repository takes work. */
const guessFor = (artifact: Artifact): Home & { readonly why: string } => {
  const first = suggestionsFor(artifact)[0]
  const repo = first?.repo ?? 'kiln'
  return { repo, folder: first?.folder ?? '', how: howsFor(repo)[0] ?? 'pr', follow: true, why: first?.why ?? '' }
}

/** The project's rule, in a few words: a pull request of its own, a commit each version. */
const ruleOf = (how: How, follow: boolean, main: string) =>
  `${how === 'pr' ? 'A pull request of its own' : `Straight to ${main}`}, ${follow ? 'a commit each version' : 'committed when you save'}`

function PlaceForm({ artifact, kept, version, onDone }: { artifact: Artifact; kept: Kept | null; version: number; onDone: () => void }) {
  const { home } = useLive()
  const navigate = useNavigate()
  const switchId = useId()
  const guess = guessFor(artifact)
  const base: Home = home ?? guess
  const saved = kept === null ? null : placeOfPath(kept.repo, kept.path)
  const start = (): Place => saved ?? { repo: base.repo, folder: base.folder, name: nameFor(artifact) }
  const [place, setPlace] = useState<Place>(start)
  const [elsewhere, setElsewhere] = useState(false)
  // The first save makes the project's place; somewhere else becomes it only when asked.
  const [makeHome, setMakeHome] = useState(home === null)
  const path = pathOf(place, artifact)
  const atBase = place.repo === base.repo && place.folder === base.folder
  const moved = kept !== null && (kept.repo !== place.repo || kept.path !== path)
  const how = kept !== null && !moved ? kept.how : base.how
  const follow = kept !== null && !moved ? kept.follow : base.follow
  const main = REPOS.find((one) => one.name === place.repo)?.main ?? 'main'
  const tag = saved === null ? 'New' : moved ? 'Moves here' : 'In git'
  const why =
    home === null && atBase
      ? `Althar’s pick: ${guess.why.charAt(0).toLowerCase()}${guess.why.slice(1)}`
      : home !== null && atBase
        ? 'The project’s place for artifacts'
        : null
  const asks = home === null || (elsewhere && !atBase)
  const save = () => {
    if (asks && makeHome) live.setHome({ repo: place.repo, folder: place.folder, how: base.how, follow: base.follow })
    live.save(artifact, { repo: place.repo, path, how, follow, version })
    onDone()
  }
  const toSettings = () => {
    onDone()
    void navigate({ to: '/projects/$projectId', params: { projectId: KILN }, search: { room: Room.Settings, section: 'code' } })
  }
  const action = kept === null ? `Save to ${place.repo}` : moved ? 'Move it' : kept.version < version ? `Commit v${version}` : null
  return (
    <div className={k.keep} data-picker="place">
      <Head artifact={artifact} kept={kept} title={`Save ${artifact.title} to ${place.repo}`} onDone={onDone} />
      {elsewhere ? (
        <Tree artifact={artifact} place={place} onPlace={setPlace} saved={saved} />
      ) : (
        <div className={k.body}>
          <div className={k.spot}>
            <span className={k.spotGlyph}>
              <Glyph name="folder" size={15} />
            </span>
            <span className={k.optionWords}>
              <span className={k.optionPath}>
                <Trail repo={place.repo} folder={place.folder} />
                <NameInput artifact={artifact} place={place} onPlace={setPlace} saved={saved} />
                <span className={k.newTag} data-tag={tag}>
                  {tag}
                </span>
              </span>
              {why !== null && <span className={k.optionWhy}>{why}</span>}
            </span>
          </div>
        </div>
      )}
      <div className={k.rules}>
        {asks && (
          <span className={k.fromNow}>
            <Switch checked={makeHome} onChange={setMakeHome} labelledBy={switchId} />
            <span id={switchId}>Save artifacts here from now on</span>
          </span>
        )}
        <span className={k.rule}>
          {ruleOf(how, follow, main)}
          <span className={k.ruleSep}>·</span>
          <button type="button" className={k.ruleLink} onClick={toSettings}>
            Settings
          </button>
        </span>
      </div>
      <div className={k.foot}>
        <button
          type="button"
          className={k.footMenu}
          onClick={() => {
            // Back from the tree is back where it was, with the name as typed.
            if (elsewhere) setPlace({ ...start(), name: place.name })
            setElsewhere(!elsewhere)
          }}
        >
          <Glyph name={elsewhere ? 'left' : 'folder'} size={13} />
          {elsewhere ? 'Back' : 'Somewhere else'}
        </button>
        <span className={k.footGap} />
        {action !== null && (
          <Button variant="ink" size="small" disabled={place.name.trim() === ''} onClick={save}>
            {action}
          </Button>
        )}
      </div>
    </div>
  )
}
