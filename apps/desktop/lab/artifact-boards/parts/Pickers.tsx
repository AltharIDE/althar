import { Fragment, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '@althar/ui'

import { type Artifact, boardCount, REPOS } from '../artifacts'
import { useLive } from '../live'
import { above, type Entry, entriesOf, foldersIn, isFolder, type Place, suggestionsFor } from '../repos'
import { Glyph } from './Glyph'
import k from './keep.module.css'

/*
 * Four ways to pick where an artifact goes in a repository, for the lab's
 * E. Each shows the new folder (or file) where it would land, among what's
 * there already, its name typed in place:
 *
 * - Path: the path as a row whose every part is a menu of what's beside it,
 *   over a list of what's in the folder, like a save dialog.
 * - Tree: the repository as the file tree an editor has, the new folder in
 *   it with the files it adds; click a folder, or drag it there.
 * - Columns: the repository's folders in columns, as a Finder does, what it
 *   adds at the end.
 * - Suggested: where Althar would put it and why, one click each, and a
 *   find for any other folder by its words.
 */

export interface PickerProps {
  readonly artifact: Artifact
  readonly place: Place
  readonly onPlace: (place: Place) => void
  /** Where it is in git now, if it's saved. */
  readonly saved: Place | null
}

const same = (a: Place | null, b: Place) => a !== null && a.repo === b.repo && a.folder === b.folder && a.name === b.name
/** What the new row says: new, where it is in git already, or where it moves. */
const tagOf = (props: PickerProps) => (props.saved === null ? 'New' : same(props.saved, props.place) ? 'In git' : 'Moves here')
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const parentOf = (folder: string) => {
  const parts = folder.split('/').filter(Boolean)
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : ''
}
const lastOf = (folder: string) => folder.split('/').filter(Boolean).at(-1) ?? ''
const shown = (repo: string, folder: string) => (folder === '' ? `${repo}/` : folder)

/** Where a repository's chosen, unless the person goes elsewhere: where Althar would put it there. */
const homeIn = (artifact: Artifact, repo: string) => suggestionsFor(artifact).find((one) => one.repo === repo)?.folder ?? ''

const filesOf = (artifact: Artifact) =>
  isFolder(artifact)
    ? [
        { name: 'canvas.json', what: `${plural(artifact.pages.length, 'page')}, ${plural(boardCount(artifact), 'board')}` },
        { name: 'boards/', what: 'each board’s page' },
        { name: 'README.md', what: 'every board as a picture' },
      ]
    : []

type Item = Entry | { readonly kind: 'new'; readonly name: string }
/** What's in a folder, and the new one where it sorts among them. */
const withNew = (entries: ReadonlyArray<Entry>, place: Place): ReadonlyArray<Item> =>
  [...entries, { kind: 'new' as const, name: place.name || '…' }].sort((a, b) => a.name.localeCompare(b.name))

/* ——— its name, typed in place ——— */

/** Its name in the folder, typed in place: as wide as it is. A slash makes a new folder on the way. */
export function NameInput({ artifact, place, onPlace }: PickerProps) {
  const measure = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    setWidth(measure.current?.offsetWidth ?? 0)
  }, [place.name])
  return (
    <span className={k.name}>
      <span ref={measure} className={k.nameMeasure} aria-hidden>
        {place.name || ' '}
      </span>
      <input
        className={k.nameInput}
        style={{ width: width + 8 }}
        value={place.name}
        spellCheck={false}
        aria-label={isFolder(artifact) ? 'Its folder’s name' : 'Its file’s name'}
        onChange={(event) => onPlace({ ...place, name: event.target.value })}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') event.stopPropagation()
        }}
        draggable={false}
      />
      {isFolder(artifact) && <span className={k.nameSlash}>/</span>}
    </span>
  )
}

function RepoMenu({ artifact, place, onPlace, field = false }: PickerProps & { field?: boolean }) {
  return (
    <Menu
      label="Repository"
      width={280}
      trigger={
        <button type="button" className={k.repo} data-field={field || undefined}>
          <Glyph name="repo" size={13} />
          {place.repo}
          <Glyph name="down" size={10} />
        </button>
      }
    >
      <MenuRadioGroup
        label="Repository"
        value={place.repo}
        onChange={(repo) => repo !== place.repo && onPlace({ ...place, repo, folder: homeIn(artifact, repo) })}
      >
        {REPOS.map((one) => (
          <MenuRadioItem key={one.name} value={one.name} description={one.what}>
            {one.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/** A line of a folder's listing: a folder, an artifact saved there, the new one, or a file it adds. */
function Line({
  item,
  depth = 0,
  here,
  props,
  twist,
  onClick,
  drop,
  still = false,
}: {
  item: Item
  depth?: number
  here?: boolean
  props: PickerProps
  twist?: ReactNode
  onClick?: () => void
  drop?: { over: boolean; onOver: (over: boolean) => void; onDrop: () => void }
  /** The new one's name shown, not typed here: it's typed elsewhere in the picker. */
  still?: boolean
}) {
  const indent = { paddingLeft: 6 + depth * 14 }
  if (item.kind === 'new')
    return (
      <div
        className={k.row}
        data-new
        style={indent}
        draggable={drop !== undefined}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', props.place.name)
          event.dataTransfer.effectAllowed = 'move'
        }}
        title={drop !== undefined ? 'Drag it to another folder' : undefined}
      >
        <span className={k.twist}>{isFolder(props.artifact) && <Glyph name="down" size={10} />}</span>
        <Glyph name={isFolder(props.artifact) ? 'folder' : 'file'} size={13} />
        {still ? (
          <span className={k.rowName}>
            {props.place.name}
            {isFolder(props.artifact) ? '/' : ''}
          </span>
        ) : (
          <NameInput {...props} />
        )}
        <span className={k.newTag} data-tag={tagOf(props)}>
          {tagOf(props)}
        </span>
      </div>
    )
  if (item.kind === 'artifact')
    return (
      <div className={k.row} data-saved style={indent} title={`${item.artifact.title}, saved here`}>
        <span className={k.twist} />
        <Glyph name={item.folder ? 'folder' : 'file'} size={13} />
        <span className={k.rowName}>
          {item.name}
          {item.folder ? '/' : ''}
        </span>
        <span className={k.rowWhat}>{item.artifact.title}</span>
      </div>
    )
  return (
    <div
      role="treeitem"
      aria-selected={here === true}
      tabIndex={-1}
      className={k.row}
      data-here={here === true || undefined}
      data-over={drop?.over === true || undefined}
      style={indent}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onClick?.()
      }}
      onDragOver={
        drop === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              drop.onOver(true)
            }
      }
      onDragLeave={drop === undefined ? undefined : () => drop.onOver(false)}
      onDrop={
        drop === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              drop.onDrop()
            }
      }
    >
      <span className={k.twist}>{twist}</span>
      <Glyph name="folder" size={13} />
      <span className={k.rowName}>{item.name}/</span>
    </div>
  )
}

/** The files it writes, marked as a commit adds them unless they're there already. */
function Adds({ props, depth }: { props: PickerProps; depth: number }) {
  const there = same(props.saved, props.place)
  return (
    <>
      {filesOf(props.artifact).map((file) => (
        <div key={file.name} className={k.row} data-adds style={{ paddingLeft: 6 + depth * 14 }}>
          <span className={k.twist}>{!there && <span className={k.plus}>+</span>}</span>
          <Glyph name={file.name.endsWith('/') ? 'folder' : 'file'} size={13} />
          <span className={k.rowName}>{file.name}</span>
          <span className={k.rowWhat}>{file.what}</span>
        </div>
      ))}
    </>
  )
}

/* ——— I. Path: every part a menu, over the folder's listing ——— */

export function PathPicker(props: PickerProps) {
  const { artifact, place, onPlace } = props
  useLive()
  const levels = above(place.folder)
  const deeper = entriesOf(place.repo, place.folder, artifact).filter((one) => one.kind === 'folder')
  const items = withNew(entriesOf(place.repo, place.folder, artifact), place)
  return (
    <div className={k.body}>
      <div className={k.crumbs}>
        <RepoMenu {...props} />
        {levels.map((level) => {
          const parent = parentOf(level)
          const siblings = entriesOf(place.repo, parent, artifact).filter((one) => one.kind === 'folder')
          return (
            <Fragment key={level}>
              <span className={k.sep}>/</span>
              <Menu
                label={`Folders in ${shown(place.repo, parent)}`}
                width={240}
                trigger={
                  <button type="button" className={k.crumb}>
                    {lastOf(level)}
                  </button>
                }
              >
                <MenuRadioGroup
                  label={`Folders in ${shown(place.repo, parent)}`}
                  value={level}
                  onChange={(folder) => onPlace({ ...place, folder })}
                >
                  {siblings.map((one) => (
                    <MenuRadioItem key={one.name} value={one.kind === 'folder' ? one.path : one.name}>
                      {one.name}/
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem icon="arrow" onSelect={() => onPlace({ ...place, folder: parent })}>
                  Up to {shown(place.repo, parent)}
                </MenuItem>
              </Menu>
            </Fragment>
          )
        })}
        <span className={k.sep}>/</span>
        {deeper.length > 0 && (
          <Menu
            label={`Folders in ${shown(place.repo, place.folder)}`}
            width={240}
            trigger={
              <button type="button" className={k.into} aria-label={`Into a folder in ${shown(place.repo, place.folder)}`}>
                <Glyph name="right" size={11} />
              </button>
            }
          >
            {deeper.map((one) =>
              one.kind === 'folder' ? (
                <MenuItem key={one.name} onSelect={() => onPlace({ ...place, folder: one.path })}>
                  {one.name}/
                </MenuItem>
              ) : null,
            )}
          </Menu>
        )}
        <NameInput {...props} />
      </div>
      <div className={k.listing} role="tree" aria-label={`In ${shown(place.repo, place.folder)}`}>
        {place.folder !== '' && (
          <div
            className={k.row}
            data-up
            role="treeitem"
            aria-selected={false}
            tabIndex={-1}
            onClick={() => onPlace({ ...place, folder: parentOf(place.folder) })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onPlace({ ...place, folder: parentOf(place.folder) })
            }}
          >
            <span className={k.twist} />
            <Glyph name="folder" size={13} />
            <span className={k.rowName}>..</span>
          </div>
        )}
        {items.map((item) =>
          item.kind === 'new' ? (
            <Fragment key="new">
              <Line item={item} props={props} still />
              <Adds props={props} depth={1} />
            </Fragment>
          ) : (
            <Line
              key={item.name}
              item={item}
              props={props}
              twist={item.kind === 'folder' ? <Glyph name="right" size={10} /> : null}
              onClick={item.kind === 'folder' ? () => onPlace({ ...place, folder: item.path }) : undefined}
            />
          ),
        )}
      </div>
    </div>
  )
}

/* ——— II. Tree: the repository as an editor's file tree ——— */

export function Tree(props: PickerProps) {
  const { artifact, place, onPlace } = props
  useLive()
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(above(place.folder)))
  const [find, setFind] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const newRow = useRef<HTMLDivElement>(null)
  const q = find.trim().toLowerCase()
  const all = foldersIn(place.repo)
  const shows = (path: string) => q === '' || all.some((one) => one.startsWith(path) && one.toLowerCase().includes(q))
  useLayoutEffect(() => {
    newRow.current?.querySelector('[data-new]')?.scrollIntoView({ block: 'nearest' })
  }, [place.repo, place.folder])
  // It goes where it's clicked or dropped, and that folder opens to show it.
  const put = (folder: string) => {
    onPlace({ ...place, folder })
    setOpen((was) => new Set([...was, ...above(folder)]))
    setOver(null)
  }
  const toggle = (path: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const rowsIn = (folder: string, depth: number): ReactNode[] =>
    (folder === place.folder ? withNew(entriesOf(place.repo, folder, artifact), place) : entriesOf(place.repo, folder, artifact)).flatMap(
      (item) => {
        if (item.kind === 'new')
          return [
            <div key="new" ref={newRow} className={k.group}>
              <Line item={item} depth={depth} props={props} drop={{ over: false, onOver: () => undefined, onDrop: () => undefined }} />
              <Adds props={props} depth={depth + 1} />
            </div>,
          ]
        if (item.kind === 'artifact')
          return q === '' || item.name.toLowerCase().includes(q) ? [<Line key={item.name} item={item} depth={depth} props={props} />] : []
        if (!shows(item.path)) return []
        const isOpen = q !== '' || open.has(item.path) || item.path === place.folder
        return [
          <Line
            key={item.path}
            item={item}
            depth={depth}
            here={item.path === place.folder}
            props={props}
            twist={
              item.deeper || item.path === place.folder ? (
                <button
                  type="button"
                  className={k.twistButton}
                  aria-label={isOpen ? `Close ${item.name}` : `Open ${item.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(item.path)
                  }}
                >
                  <Glyph name={isOpen ? 'down' : 'right'} size={10} />
                </button>
              ) : null
            }
            onClick={() => put(item.path)}
            drop={{ over: over === item.path, onOver: (yes) => setOver(yes ? item.path : null), onDrop: () => put(item.path) }}
          />,
          ...(isOpen ? rowsIn(item.path, depth + 1) : []),
        ]
      },
    )
  return (
    <div className={k.body}>
      <div className={k.treeBar}>
        <RepoMenu
          {...props}
          field
          onPlace={(next) => {
            onPlace(next)
            setOpen(new Set(above(next.folder)))
          }}
        />
        <label className={k.find}>
          <Glyph name="search" size={13} />
          <input
            value={find}
            placeholder="Find a folder"
            spellCheck={false}
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && find !== '') {
                event.preventDefault()
                setFind('')
              }
            }}
          />
        </label>
      </div>
      <div className={k.tree} role="tree" aria-label={`Folders in ${place.repo}`}>
        <Line
          item={{ kind: 'folder', name: place.repo, path: '', deeper: true }}
          here={place.folder === ''}
          props={props}
          twist={<Glyph name="down" size={10} />}
          onClick={() => put('')}
          drop={{ over: over === '', onOver: (yes) => setOver(yes ? '' : null), onDrop: () => put('') }}
        />
        {rowsIn('', 1)}
      </div>
    </div>
  )
}

/* ——— III. Columns: the folders in columns, as a Finder does ——— */

export function Columns(props: PickerProps) {
  const { artifact, place, onPlace } = props
  useLive()
  const scroller = useRef<HTMLDivElement>(null)
  // The folder it goes in is always in sight: the columns scroll to their end as it goes deeper.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el !== null) el.scrollLeft = el.scrollWidth
  }, [place.repo, place.folder])
  const levels = ['', ...above(place.folder)]
  const files = filesOf(artifact)
  return (
    <div className={k.body}>
      <div ref={scroller} className={k.columns}>
        <div className={k.column} role="listbox" aria-label="Repositories">
          {REPOS.map((one) => (
            <button
              key={one.name}
              type="button"
              role="option"
              aria-selected={one.name === place.repo}
              className={k.cell}
              data-on={one.name === place.repo || undefined}
              onClick={() => onPlace({ ...place, repo: one.name, folder: one.name === place.repo ? '' : homeIn(artifact, one.name) })}
            >
              <Glyph name="repo" size={13} />
              <span className={k.cellName}>{one.name}</span>
              <Glyph name="right" size={10} />
            </button>
          ))}
        </div>
        {levels.map((level, i) => {
          const next = levels[i + 1]
          const items =
            level === place.folder ? withNew(entriesOf(place.repo, level, artifact), place) : entriesOf(place.repo, level, artifact)
          return (
            <div key={`${place.repo}|${level}`} className={k.column} role="listbox" aria-label={`In ${shown(place.repo, level)}`}>
              {items.map((item) =>
                item.kind === 'new' ? (
                  <div key="new" className={k.cell} data-new>
                    <Glyph name={isFolder(artifact) ? 'folder' : 'file'} size={13} />
                    <NameInput {...props} />
                  </div>
                ) : item.kind === 'artifact' ? (
                  <div key={item.name} className={k.cell} data-saved title={`${item.artifact.title}, saved here`}>
                    <Glyph name={item.folder ? 'folder' : 'file'} size={13} />
                    <span className={k.cellName}>{item.name}</span>
                  </div>
                ) : (
                  <button
                    key={item.name}
                    type="button"
                    role="option"
                    aria-selected={item.path === next}
                    className={k.cell}
                    data-on={item.path === next || undefined}
                    onClick={() => onPlace({ ...place, folder: item.path })}
                  >
                    <Glyph name="folder" size={13} />
                    <span className={k.cellName}>{item.name}</span>
                    <Glyph name="right" size={10} />
                  </button>
                ),
              )}
            </div>
          )
        })}
        <div className={k.preview}>
          <span className={k.previewName}>
            <Glyph name={isFolder(artifact) ? 'folder' : 'file'} size={13} />
            {place.name}
            {isFolder(artifact) ? '/' : ''}
          </span>
          {files.length > 0 ? (
            <ul className={k.previewFiles}>
              {files.map((file) => (
                <li key={file.name}>
                  <code>
                    {!same(props.saved, place) && <span className={k.plus}>+ </span>}
                    {file.name}
                  </code>
                  <span>{file.what}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className={k.previewWhat}>One file, each version a commit</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ——— IV. Suggested: where Althar would put it, and a find for anywhere else ——— */

export function Suggested(props: PickerProps) {
  const { artifact, place, onPlace } = props
  useLive()
  const options = suggestionsFor(artifact)
  const matched = options.find((one) => one.repo === place.repo && one.folder === place.folder)?.key ?? 'else'
  const [elsewhere, setElsewhere] = useState(matched === 'else')
  const pick = elsewhere ? 'else' : matched
  const choose = (key: string, then: () => void) => ({
    role: 'radio' as const,
    'aria-checked': pick === key,
    tabIndex: pick === key ? 0 : -1,
    onClick: then,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        then()
      }
    },
  })
  return (
    <div className={k.body}>
      <div className={k.options} role="radiogroup" aria-label="Where it goes">
        {options.map((one) => (
          <div
            key={one.key}
            className={k.option}
            data-on={pick === one.key || undefined}
            {...choose(one.key, () => {
              setElsewhere(false)
              onPlace({ ...place, repo: one.repo, folder: one.folder })
            })}
          >
            <span className={k.dot} aria-hidden />
            <span className={k.optionWords}>
              <span className={k.optionTitle}>{one.title}</span>
              <span className={k.optionPath}>
                <Trail repo={one.repo} folder={one.folder} />
                {pick === one.key ? (
                  <NameInput {...props} />
                ) : (
                  <span>
                    {place.name}
                    {isFolder(artifact) ? '/' : ''}
                  </span>
                )}
              </span>
              <span className={k.optionWhy}>{one.why}</span>
            </span>
          </div>
        ))}
        <div className={k.option} data-on={pick === 'else' || undefined} {...choose('else', () => setElsewhere(true))}>
          <span className={k.dot} aria-hidden />
          <span className={k.optionWords}>
            <span className={k.optionTitle}>Somewhere else</span>
            {pick === 'else' ? (
              <Find {...props} />
            ) : (
              <span className={k.optionWhy}>Any folder in {REPOS.map((one) => one.name).join(' or ')}</span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export function Trail({ repo, folder }: { repo: string; folder: string }) {
  return (
    <>
      {[repo, ...folder.split('/').filter(Boolean)].map((part, i) => (
        <span key={`${i}|${part}`} className={i === 0 ? k.trailRepo : undefined}>
          {part}
          <span className={k.trailSep}>/</span>
        </span>
      ))}
    </>
  )
}

/** Any folder in the project's repositories, found by its words: arrows and Enter, or a click. */
function Find(props: PickerProps) {
  const { place, onPlace } = props
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const words = q
    .toLowerCase()
    .split(/[\s/]+/)
    .filter(Boolean)
  const found = REPOS.flatMap((repo) =>
    foldersIn(repo.name).map((folder) => ({ repo: repo.name, folder, label: `${repo.name}/${folder}` })),
  )
    .filter((one) => words.every((word) => one.label.toLowerCase().includes(word)))
    .slice(0, 6)
  const take = (one: { repo: string; folder: string } | undefined) => {
    if (one === undefined) return
    onPlace({ ...place, repo: one.repo, folder: one.folder })
    setQ('')
  }
  return (
    <span className={k.findWrap} onClick={(event) => event.stopPropagation()}>
      <label className={k.find}>
        <Glyph name="search" size={13} />
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens to be typed in
          autoFocus
          value={q}
          placeholder="Find a folder"
          spellCheck={false}
          role="combobox"
          aria-expanded={q !== ''}
          aria-controls="keep-find"
          onChange={(event) => {
            setQ(event.target.value)
            setAt(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (q === '') return
              event.preventDefault()
              return setQ('')
            }
            event.stopPropagation()
            if (event.key === 'ArrowDown') setAt((was) => Math.min(was + 1, found.length - 1))
            else if (event.key === 'ArrowUp') setAt((was) => Math.max(was - 1, 0))
            else if (event.key === 'Enter') take(found[at])
            else return
            event.preventDefault()
          }}
        />
      </label>
      {q !== '' ? (
        <ul id="keep-find" className={k.found} role="listbox" aria-label="Folders found">
          {found.length === 0 && <li className={k.foundNone}>No folder has “{q}”</li>}
          {found.map((one, i) => (
            <li
              key={one.label}
              role="option"
              aria-selected={i === at}
              className={k.foundItem}
              data-at={i === at || undefined}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                take(one)
              }}
            >
              <Glyph name={one.folder === '' ? 'repo' : 'folder'} size={12} />
              <Marked text={one.label} words={words} />
            </li>
          ))}
        </ul>
      ) : (
        <span className={k.optionPath}>
          <Trail repo={place.repo} folder={place.folder} />
          <NameInput {...props} />
        </span>
      )}
    </span>
  )
}

/** A label with the words found in it marked. */
function Marked({ text, words }: { text: string; words: ReadonlyArray<string> }) {
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const word of words) {
    const i = lower.indexOf(word)
    if (i >= 0) marked.fill(true, i, i + word.length)
  }
  const runs: Array<{ text: string; on: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const last = runs.at(-1)
    if (last !== undefined && last.on === marked[i]) runs[runs.length - 1] = { text: last.text + text[i], on: last.on }
    else runs.push({ text: text[i] ?? '', on: marked[i] === true })
  }
  return (
    <span className={k.foundLabel}>
      {runs.map((run, i) => (run.on ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
    </span>
  )
}
