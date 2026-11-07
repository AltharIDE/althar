// Scrappy, surface 5: a task's parts (its workspace, pull requests, reviews, issues, runs, outputs, access) behind one Parts button just before the faces, which never move. Three looks for it and what it opens: a list by group (A), tiles (B), what waits on you first (C).
import type { ReactElement } from 'react'

import { ChromeButton } from '../../../../src/chrome/ChromeButton/ChromeButton'
import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Menu, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Popover } from '../../../../src/primitives/Popover/Popover'
import { PartsDrill } from './Drill'
import s from './parts.module.css'

type Group = 'code' | 'review' | 'issues' | 'running' | 'outputs' | 'access'

export interface Part {
  readonly id: string
  readonly group: Group
  readonly icon: IconName | Brand
  /** Its name, short: Worktree, #635, DEV-188. */
  readonly name: string
  /** Where it stands, in a few words: Open · checks pass. */
  readonly detail: string
  /** Something about it waits on the person, or failed, or it runs. */
  readonly tone?: 'you' | 'bad' | 'live'
  /** What the person does with it now, where something waits: Merge, See the check. */
  readonly act?: string
}

export const GROUPS: Readonly<Record<Group, string>> = {
  code: 'Code',
  review: 'Reviews',
  issues: 'Issues',
  running: 'Running',
  outputs: 'Made',
  access: 'Access',
}

const FEW: ReadonlyArray<Part> = [
  { id: 'wt', group: 'code', icon: 'folder', name: 'Worktree', detail: '4 files changed' },
  { id: 'pr', group: 'code', icon: 'pr', name: '#638', detail: 'Draft · checks pass' },
  { id: 'issue', group: 'issues', icon: Brand.Linear, name: 'DEV-214', detail: 'Agents work as the person’s own' },
]

const MANY: ReadonlyArray<Part> = [
  { id: 'wt', group: 'code', icon: 'folder', name: 'Worktree', detail: '6 files changed' },
  { id: 'pr', group: 'code', icon: 'pr', name: '#635', detail: 'Checks pass · reviewed', tone: 'you', act: 'Merge' },
  { id: 'pr2', group: 'code', icon: 'pr', name: '#639', detail: 'Draft · 1 check fails', tone: 'bad', act: 'See the check' },
  { id: 'rv', group: 'review', icon: 'answer', name: 'Review of #635', detail: 'GPT-6.1 Sol · nothing found' },
  { id: 'i1', group: 'issues', icon: Brand.Linear, name: 'DEV-188', detail: 'Runs vanish from the pill' },
  { id: 'i2', group: 'issues', icon: Brand.Linear, name: 'DEV-191', detail: 'Pill hides a run’s address' },
  { id: 'web', group: 'running', icon: 'globe', name: 'localhost:5367', detail: 'In the browser', tone: 'live' },
  { id: 'sb', group: 'running', icon: 'play', name: 'Storybook', detail: 'Running on 6126', tone: 'live' },
  { id: 'shots', group: 'outputs', icon: 'image', name: '4 screenshots', detail: 'The pill, light and dark' },
  { id: 'net', group: 'access', icon: 'lock', name: 'Network', detail: 'Given for this task' },
]

const REVIEW: ReadonlyArray<Part> = [
  { id: 'pr', group: 'code', icon: 'pr', name: '#641 by ninemate', detail: 'Open · read only' },
  { id: 'draft', group: 'review', icon: 'answer', name: 'Review draft', detail: '3 findings, not posted', tone: 'you', act: 'Post it' },
]

/** The parts of the task open, by its thread. */
export const partsOf = (hash: string): ReadonlyArray<Part> =>
  hash.includes('th-runs') ? MANY : hash.includes('th-review') ? REVIEW : hash.includes('th-adr') ? FEW : FEW.slice(0, 1)

const isBrand = (icon: Part['icon']): icon is Brand => (Object.values(Brand) as string[]).includes(icon)
export const glyph = (part: Part, size = 13) =>
  isBrand(part.icon) ? <BrandMark brand={part.icon} size={size - 1} /> : <Icon name={part.icon} size={size} />

/** + Add: what a task can take on, any time. */
export function AddMenu({ trigger }: { trigger: ReactElement }) {
  return (
    <Menu label="Add to this task" width={280} trigger={trigger}>
      <MenuItem icon="folder" description="A checkout of its own, to change code in" onSelect={() => undefined}>
        A worktree
      </MenuItem>
      <MenuItem icon="pr" description="Opened from its branch, or one that exists" onSelect={() => undefined}>
        A pull request
      </MenuItem>
      <MenuItem icon="answer" description="A draft of a review of any pull request" onSelect={() => undefined}>
        A review
      </MenuItem>
      <MenuItem icon="list" description="From Linear or GitHub, for its lead to read" onSelect={() => undefined}>
        An issue
      </MenuItem>
      <MenuItem icon="globe" description="A page its lead can see and click" onSelect={() => undefined}>
        A browser
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="lock" description="What its lead may run and reach" onSelect={() => undefined}>
        Access
      </MenuItem>
    </Menu>
  )
}

const AddButton = () => (
  <AddMenu
    trigger={
      <button type="button" className={s.add}>
        <Icon name="plus" size={12} />
        Add
      </button>
    }
  />
)

const waits = (part: Part) => part.tone === 'you' || part.tone === 'bad'

/** A: every part by group, each with where it stands. */
export function PartsList({ parts }: { parts: ReadonlyArray<Part> }) {
  const groups = [...new Set(parts.map((one) => one.group))]
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <span className={s.listTitle}>Parts</span>
        <AddButton />
      </div>
      {groups.map((group) => (
        <section key={group} className={s.group}>
          <h4 className={s.groupName}>{GROUPS[group]}</h4>
          <ul className={s.items}>
            {parts
              .filter((one) => one.group === group)
              .map((one) => (
                <li key={one.id}>
                  <button type="button" className={s.item} data-tone={one.tone}>
                    <span className={s.itemGlyph}>{glyph(one)}</span>
                    <span className={s.itemName}>{one.name}</span>
                    <span className={s.itemDetail}>{one.detail}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** B: a tile each, two to a row, what waits first: its group over its name, where it stands under it, and what to do with it. */
export function PartsTiles({ parts }: { parts: ReadonlyArray<Part> }) {
  const ordered = [...parts.filter(waits), ...parts.filter((one) => !waits(one))]
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <span className={s.listTitle}>Parts</span>
        <AddButton />
      </div>
      <ul className={s.tiles}>
        {ordered.map((one) => (
          <li key={one.id} className={s.tile} data-tone={one.tone}>
            <span className={s.tileHead}>
              <span className={s.tileGlyph}>{glyph(one, 14)}</span>
              <span className={s.tileGroup}>{GROUPS[one.group]}</span>
              {one.tone === 'live' && <span className={s.liveDot} aria-hidden />}
            </span>
            <span className={s.tileName}>{one.name}</span>
            <span className={s.tileDetail}>{one.detail}</span>
            {one.act !== undefined && (
              <Button size="small" variant={one.tone === 'you' ? 'default' : 'quiet'} className={s.tileAct}>
                {one.act}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export type Look = 'list' | 'tiles' | 'waits'

/** C's button: the parts' own glyphs, the first four, then how many more; one that waits on you in its colour. */
const GlyphStack = ({ parts, ...rest }: { parts: ReadonlyArray<Part> }) => {
  const shown = [...parts.filter(waits), ...parts.filter((one) => !waits(one))].slice(0, 4)
  const more = parts.length - shown.length
  const waiting = parts.some(waits)
  return (
    <button type="button" className={s.stack} aria-label={`Parts, ${parts.length}${waiting ? ', something waits on you' : ''}`} {...rest}>
      {shown.map((one) => (
        <span key={one.id} className={s.stackGlyph} data-tone={one.tone}>
          {glyph(one, 13)}
        </span>
      ))}
      {more > 0 && <span className={s.stackMore}>{`+${more}`}</span>}
    </button>
  )
}

/** One button in the bar, just before the faces, that opens every part. */
export function PartsButton({ parts, look }: { parts: ReadonlyArray<Part>; look: Look }) {
  const waiting = parts.some(waits)
  const trigger =
    look === 'waits' ? (
      <GlyphStack parts={parts} />
    ) : (
      <ChromeButton icon="clip" label="Parts" count={parts.length} {...(waiting ? { mark: 'Something waits on you' } : {})} />
    )
  return (
    <Popover
      label="This task’s parts"
      placement="below"
      align="end"
      width={look === 'tiles' ? 460 : look === 'waits' ? 380 : 340}
      padded={false}
      trigger={trigger}
    >
      {look === 'list' ? <PartsList parts={parts} /> : look === 'tiles' ? <PartsTiles parts={parts} /> : <PartsDrill parts={parts} />}
    </Popover>
  )
}
