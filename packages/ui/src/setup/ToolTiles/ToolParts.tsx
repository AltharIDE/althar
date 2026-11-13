import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandChip, BrandMark } from '../../foundations/Marks/Marks'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { cx } from '../../lib/cx'
import { focusQuietly } from '../../lib/focusQuietly'
import { Button } from '../../primitives/Button/Button'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Problem } from '../../primitives/Problem/Problem'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ControlGrid, ControlLine, ControlToggle } from '../ControlCenter/ControlCenter'
import { EmptyState } from '../EmptyState/EmptyState'
import { SettingGroup } from '../Preferences/Preferences'
import { TOOL_ROLES, type ToolProjectView, type ToolRoleId } from './tools'
import s from './ToolTiles.module.css'

/*
 * What the server and skill tiles share: the words for who gets one and
 * where, a tile (the quick cards' round switch and name), the dashed tile
 * that adds one, the designed empty card, the three role switches and the
 * projects' marks of an opened one, the calm placeholder while they are
 * read and the failure with Try again, and focus going back to the tile an
 * opened one came from.
 */

/* ---- the words ------------------------------------------------------------------- */

export interface ToolWordsText {
  /** Each role, as a switch names it. */
  roles: Record<ToolRoleId, string>
  /** Who gets it, in a few words: Leads and reviewers only; nothing where every role does. */
  whoGets: (roles: readonly ToolRoleId[]) => string
  /** Where it isn't given, from the projects pressed out and those left in: not in fnt, only in ledger; nothing where every project gets it. */
  where: (off: readonly string[], on: readonly string[]) => string
  /** Given to no role. */
  off: string
  /** Who gets it and where, on one line. */
  reach: (who: string, where: string) => string
  /** A role's switch, for a screen reader: Leads get linear. */
  roleGets: (role: ToolRoleId, name: string) => string
  /** The projects' marks, as a group. */
  projectsFor: (name: string) => string
  whoGetsLabel: string
  projectsLabel: string
  /** Names in a sentence: Codex and OpenCode. */
  and: (names: readonly string[]) => string
  loading: string
  retry: string
  /** The group of a repository's own. */
  inRepository: (project: string) => string
  back: string
}

const and = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
const ROLES_IN_A_LINE: Record<ToolRoleId, string> = { lead: 'leads', reviewer: 'reviewers', coordinator: 'the coordinator' }
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)
/** Two names said, more counted: a tile's line stays whole however many projects there are. */
const some = (names: readonly string[]) => (names.length <= 2 ? and(names) : `${names.length} projects`)

export const toolWordsText: ToolWordsText = {
  roles: { lead: 'Leads', reviewer: 'Reviewers', coordinator: 'The coordinator' },
  // Every role is the usual, and the usual isn't said: a tile's line is only for what differs.
  whoGets: (roles) =>
    roles.length === TOOL_ROLES.length
      ? ''
      : `${and(TOOL_ROLES.filter((role) => roles.includes(role)).map((role) => ROLES_IN_A_LINE[role]))} only`,
  where: (off, on) =>
    off.length === 0 ? '' : on.length === 0 ? 'in no project' : on.length < off.length ? `only in ${some(on)}` : `not in ${some(off)}`,
  off: 'Off',
  reach: (who, where) => sentence([who, where].filter((part) => part !== '').join(' · ')),
  roleGets: (role, name) =>
    role === 'coordinator' ? `The coordinator gets ${name}` : `${role === 'lead' ? 'Leads' : 'Reviewers'} get ${name}`,
  projectsFor: (name) => `Projects that get ${name}`,
  whoGetsLabel: 'Who gets it',
  projectsLabel: 'Projects',
  and,
  loading: 'Reading what your agents have…',
  retry: 'Try again',
  inRepository: (project) => `In ${project}’s repository`,
  back: 'Back',
}

/** Who gets it and where, in a line, only where it differs: Leads only · not in fnt; Off; nothing for every role in every project. */
export const reachOf = (
  one: { roles: readonly ToolRoleId[]; offIn: readonly string[]; repository: string | null },
  projects: readonly ToolProjectView[],
  t: ToolWordsText,
) => {
  if (one.roles.length === 0) return t.off
  const named = projects.length > 1 && one.repository === null
  const off = named ? projects.filter((project) => one.offIn.includes(project.id)).map((project) => project.name) : []
  const on = named ? projects.filter((project) => !one.offIn.includes(project.id)).map((project) => project.name) : []
  return t.reach(t.whoGets(one.roles), t.where(off, on))
}

/** A project's name by its id, else the id. */
export const projectName = (projects: readonly ToolProjectView[], id: string) => projects.find((one) => one.id === id)?.name ?? id

/* ---- a tile ---------------------------------------------------------------------- */

/** What a tile's round switch shows: the product's mark, else the name's first letter. */
function TileGlyph({ name, brand }: { name: string; brand: Brand | undefined }) {
  return brand === undefined ? (
    <span className={s.letter} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <BrandMark brand={brand} size={17} />
  )
}

export interface ToolTileProps {
  /** Its key in the list that moves as a whole, and what focus finds again on the way back. */
  tileKey: string
  name: string
  brand?: Brand | undefined
  line: ReactNode
  on: boolean
  onChange: (on: boolean) => void
  onOpen?: (() => void) | undefined
}

/** A server or skill: the round switch gives it to every role or none; the name opens it. */
export function ToolTile({ tileKey, name, brand, line, on, onChange, onOpen }: ToolTileProps) {
  const cell = useRef<HTMLDivElement>(null)
  const clipped = useClipped(cell, name)
  const tile = (
    <div ref={cell} className={s.cell} data-move={tileKey} data-tile={tileKey}>
      <ControlToggle
        className={s.tile}
        title={name}
        {...(line === '' ? {} : { line })}
        on={on}
        onChange={onChange}
        glyph={<TileGlyph name={name} brand={brand} />}
        {...(onOpen === undefined ? {} : { onOpen })}
      />
    </div>
  )
  // A name cut short with … shows whole on hover, and as its words take focus.
  return (
    <Tooltip label={name} placement="below" shut={!clipped}>
      {tile}
    </Tooltip>
  )
}

/** Whether a tile's name is cut short in its width: read from the name as drawn, again as the tile's width changes. */
function useClipped(cell: RefObject<HTMLElement | null>, name: string) {
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const element = cell.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const title = [...element.querySelectorAll('span')].find((one) => one.childElementCount === 0 && one.textContent === name)
    if (title === undefined) return
    const measure = () => setClipped(title.scrollWidth > title.clientWidth + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(title)
    return () => watch.disconnect()
  }, [cell, name])
  return clipped
}

/** Under a tile's name: it failed (red), what waits on the person (violet), or who gets it. */
export function TileLine({ tone, children }: { tone?: 'failed' | 'yours' | undefined; children: ReactNode }) {
  if (tone === 'failed') return <span className={s.lineFailed}>{children}</span>
  return <ControlLine tone={tone}>{children}</ControlLine>
}

/** The dashed tile at the end of a grid, which adds one. */
export function AddTile({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={cx(s.add, className)} onClick={onClick}>
      <span className={s.addCircle} aria-hidden="true">
        <Icon name="plus" size={16} />
      </span>
      <span className={s.addWords}>{children}</span>
    </button>
  )
}

/** A dashed tile for something often added: its mark or letter, its name, where it runs; pressed, it adds it. */
export function StarterTile({
  name,
  brand,
  line,
  label,
  onClick,
}: {
  name: string
  brand?: Brand | undefined
  line: string
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className={s.add} aria-label={label} onClick={onClick}>
      {brand === undefined ? (
        <span className={cx(s.letter, s.starterLetter)} aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <BrandChip brand={brand} size={30} className={s.starterChip} />
      )}
      <span className={s.starterWords}>
        <span className={s.starterName}>{name}</span>
        <span className={s.starterLine}>{line}</span>
      </span>
      <Icon name="plus" size={14} className={s.starterPlus} />
    </button>
  )
}

/** The tiles, three across, two on a narrow page; each tile spans two of the grid's six columns. */
export function TileGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ControlGrid columns={6} className={s.grid} {...(label === undefined ? {} : { role: 'group', 'aria-label': label })}>
      {children}
    </ControlGrid>
  )
}

/** A part of the section under its name: a repository's own, the agents outside Althar. */
export function ToolGroup({
  title,
  note,
  headingLevel,
  children,
}: {
  title: string
  note?: ReactNode
  headingLevel: HeadingLevel
  children: ReactNode
}) {
  return (
    <SettingGroup title={title} headingLevel={headingLevel} className={s.group} {...(note === undefined ? {} : { note })}>
      {children}
    </SettingGroup>
  )
}

/* ---- none yet -------------------------------------------------------------------- */

export interface ToolPlace {
  id: string
  name: string
  brand?: Brand | undefined
  /** The file or folder, as the person names it. */
  path: string
}

/** None yet: what will be here and how it gets here, where each agent keeps its own, then what to press. */
export function ToolsEmpty({
  icon,
  title,
  line,
  places,
  headingLevel,
  children,
}: {
  icon: IconName
  title: string
  line: string
  places: readonly ToolPlace[]
  headingLevel: HeadingLevel
  children: ReactNode
}) {
  return (
    <div className={s.none}>
      <EmptyState
        icon={icon}
        title={title}
        line={line}
        headingLevel={headingLevel}
        {...(places.length === 0
          ? {}
          : {
              actions: (
                <dl className={s.places}>
                  {places.map((place) => (
                    <div key={place.id} className={s.place}>
                      <dt>
                        <span className={s.placeMark} aria-hidden="true">
                          {place.brand === undefined ? <Icon name="plug" size={13} /> : <BrandMark brand={place.brand} size={13} />}
                        </span>
                        {place.name}
                      </dt>
                      <dd>
                        <code className={s.truncate}>{place.path}</code>
                      </dd>
                    </div>
                  ))}
                </dl>
              ),
            })}
      />
      {children}
    </div>
  )
}

/** A small heading over a run of tiles inside the empty card's section: Often added. */
export function TilesKind({ children, headingLevel }: { children: ReactNode; headingLevel: HeadingLevel }) {
  return (
    <Heading level={headingLevel} className={s.kind}>
      {children}
    </Heading>
  )
}

/* ---- while it is read, and when it can't be ---------------------------------------- */

/** Where the tiles will be, in their shape, while they are read: two rows, so the first answer lands in place. */
export function TilesLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true">
      <VisuallyHidden>{label}</VisuallyHidden>
      <TileGrid>
        {Array.from({ length: 6 }, (_, at) => (
          <span key={at} className={s.cell}>
            <Skeleton shape="sheet" height={66} className={s.ghost} />
          </span>
        ))}
      </TileGrid>
    </div>
  )
}

/** What couldn't be read, in its words, and Try again beside it. */
export function TilesFailed({ error, retry, onRetry }: { error: string; retry: string; onRetry?: (() => void) | undefined }) {
  return (
    <Problem
      banner
      as="div"
      {...(onRetry === undefined
        ? {}
        : {
            action: (
              <Button size="small" icon="reload" onClick={onRetry}>
                {retry}
              </Button>
            ),
          })}
    >
      {error}
    </Problem>
  )
}

/* ---- an opened one ------------------------------------------------------------------ */

/** A fact of an opened one: its label beside its value. */
export function SheetFact({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <div className={s.fact}>
      <span className={s.factLabel} id={id}>
        {label}
      </span>
      <div className={s.factValue}>{children}</div>
    </div>
  )
}

/** The three roles as round switches, each named under it: black where the role gets it. */
export function RoleSwitches({
  name,
  roles,
  onChange,
  text,
}: {
  name: string
  roles: readonly ToolRoleId[]
  onChange: (roles: readonly ToolRoleId[]) => void
  text: ToolWordsText
}) {
  return (
    <div className={s.roles} role="group" aria-label={text.whoGetsLabel}>
      {TOOL_ROLES.map((role) => {
        const on = roles.includes(role)
        return (
          <button
            key={role}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={text.roleGets(role, name)}
            className={s.role}
            onClick={() => onChange(TOOL_ROLES.filter((one) => (one === role ? !on : roles.includes(one))))}
          >
            <span className={cx(s.roleCircle, on && s.roleOn)} aria-hidden="true">
              <Icon name={ROLE_GLYPH[role]} size={16} />
            </span>
            <span className={s.roleName} aria-hidden="true">
              {text.roles[role]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const ROLE_GLYPH: Record<ToolRoleId, IconName> = { lead: 'work', reviewer: 'comment', coordinator: 'agents' }

/** Each project by its mark and name, pressed in where it gets it and out where it doesn't; they wrap, however many. */
export function ProjectPicks({
  name,
  projects,
  offIn,
  onChange,
  text,
}: {
  name: string
  projects: readonly ToolProjectView[]
  offIn: readonly string[]
  onChange: (project: string, on: boolean) => void
  text: ToolWordsText
}) {
  return (
    <div className={s.picks} role="group" aria-label={text.projectsFor(name)}>
      {projects.map((project) => {
        const on = !offIn.includes(project.id)
        return (
          <button
            key={project.id}
            type="button"
            aria-pressed={on}
            className={cx(s.pick, !on && s.pickOut)}
            onClick={() => onChange(project.id, !on)}
          >
            <ProjectMark seed={project.id} ink={project.ink} size={16} className={s.pickMark} />
            <span className={s.truncate}>{project.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Escape steps back out of an opened one, unless something inside it heard it first or it came from a dialog over it. */
export const escapeBack = (onBack: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  // A dialog opened from it is portalled: its keys still bubble here through React, but not through the page.
  if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
  event.preventDefault()
  onBack()
}

/**
 * Back from an opened one, focus goes to the tile it came from: to its name, which opened it, where focus went with
 * what closed. `opened` is the open tile's key, or null while the tiles show.
 */
export function useBackFocus(root: RefObject<HTMLElement | null>, opened: string | null) {
  const was = useRef(opened)
  useEffect(() => {
    const from = was.current
    was.current = opened
    if (from === null || opened !== null || root.current === null) return
    if (document.activeElement !== null && document.activeElement !== document.body) return
    const tile = [...root.current.querySelectorAll<HTMLElement>('[data-tile]')].find((one) => one.dataset.tile === from)
    if (tile === undefined) return
    focusQuietly(
      tile.matches('button') ? tile : (tile.querySelector<HTMLElement>('button:not([role="switch"])') ?? tile.querySelector('button')),
    )
  }, [opened, root])
}
