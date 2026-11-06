// Scrappy, surface 5: a task's parts (its workspace, pull requests, reviews, issues, runs, outputs, access), four ways that scale, none moving the faces, Run or the menu.
import { type ReactElement, useLayoutEffect, useRef, useState } from 'react'

import { ChromeButton } from '../../../../src/chrome/ChromeButton/ChromeButton'
import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { IconButton } from '../../../../src/primitives/IconButton/IconButton'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Popover } from '../../../../src/primitives/Popover/Popover'
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
  /** Something about it waits on the person, or failed. */
  readonly tone?: 'you' | 'bad' | 'live'
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
  { id: 'pr', group: 'code', icon: 'pr', name: '#635', detail: 'Open · checks pass', tone: 'you' },
  { id: 'pr2', group: 'code', icon: 'pr', name: '#639', detail: 'Draft · 1 check fails', tone: 'bad' },
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
  { id: 'draft', group: 'review', icon: 'answer', name: 'Review draft', detail: '3 findings, not posted', tone: 'you' },
]

/** The parts of the task open, by its thread. */
export const partsOf = (hash: string): ReadonlyArray<Part> =>
  hash.includes('th-runs') ? MANY : hash.includes('th-review') ? REVIEW : hash.includes('th-adr') ? FEW : FEW.slice(0, 1)

const isBrand = (icon: Part['icon']): icon is Brand => (Object.values(Brand) as string[]).includes(icon)
const glyph = (part: Part, size = 13) =>
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

/** The rest, past what shows: a menu of them by group. */
function More({ parts }: { parts: ReadonlyArray<Part> }) {
  const groups = [...new Set(parts.map((one) => one.group))]
  return (
    <Menu label="More parts" width={280} trigger={<ChromeButton icon="more" label={`${parts.length} more`} />}>
      {groups.map((group, at) => (
        <MenuGroup key={group} label={GROUPS[group]}>
          {at > 0 && <MenuSeparator />}
          {parts
            .filter((one) => one.group === group)
            .map((one) => (
              <MenuItem key={one.id} lead={glyph(one, 12)} description={one.detail} onSelect={() => undefined}>
                {one.name}
              </MenuItem>
            ))}
        </MenuGroup>
      ))}
    </Menu>
  )
}

/** A: after the title, in the bar's free middle: the first few as chips, the rest behind "N more", then +. */
export function PartsAfterTitle({ parts }: { parts: ReadonlyArray<Part> }) {
  const shown = parts.slice(0, 3)
  const rest = parts.slice(3)
  return (
    <span className={s.afterTitle}>
      {shown.map((one) => (
        <button key={one.id} type="button" className={s.titleChip} data-tone={one.tone}>
          {glyph(one, 12)}
          <span>{one.name}</span>
        </button>
      ))}
      {rest.length > 0 && <More parts={rest} />}
      <AddMenu trigger={<IconButton icon="plus" label="Add to this task" size="small" />} />
    </span>
  )
}

/** B: a row of its own under the bar, each part with where it stands; what doesn't fit behind "N more". */
export function PartsRow({ parts }: { parts: ReadonlyArray<Part> }) {
  const row = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(parts.length)
  // As many as the row has room for, the rest behind "N more"; again as the window changes. Each chip is measured once, all showing.
  useLayoutEffect(() => {
    const element = row.current
    if (element === null) return
    const widths = [...element.querySelectorAll<HTMLElement>('[data-chip]')].map((chip) => chip.offsetWidth + 6)
    const measure = () => {
      const all = widths.reduce((sum, one) => sum + one, 0)
      const room = element.clientWidth - 28 - (all > element.clientWidth - 28 - 70 ? 190 : 70)
      let used = 0
      let count = 0
      for (const width of widths) {
        used += width
        if (used > room) break
        count += 1
      }
      setFit(count)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [parts])
  const shown = parts.slice(0, fit)
  const rest = parts.slice(fit)
  return (
    <div className={s.row} aria-label="This task’s parts" ref={row}>
      {parts.map((one, at) => (
        <button key={one.id} type="button" className={s.rowChip} data-tone={one.tone} data-chip="" hidden={at >= shown.length}>
          {glyph(one, 12)}
          <span className={s.rowName}>{one.name}</span>
          <span className={s.rowDetail}>{one.detail}</span>
        </button>
      ))}
      {rest.length > 0 && <More parts={rest} />}
      <AddMenu
        trigger={
          <button type="button" className={s.rowAdd}>
            <Icon name="plus" size={12} />
            Add
          </button>
        }
      />
    </div>
  )
}

/** C and D: every part, by group, each with where it stands; Add at the head. */
export function PartsList({ parts, onClose }: { parts: ReadonlyArray<Part>; onClose?: () => void }) {
  const groups = [...new Set(parts.map((one) => one.group))]
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <span className={s.listTitle}>Parts</span>
        <AddMenu
          trigger={
            <button type="button" className={s.rowAdd}>
              <Icon name="plus" size={12} />
              Add
            </button>
          }
        />
        {onClose !== undefined && <IconButton icon="close" label="Close parts" size="small" onClick={onClose} />}
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

/** C: one button in the bar, its count beside it, that opens every part. */
export function PartsButton({ parts }: { parts: ReadonlyArray<Part> }) {
  const waits = parts.some((one) => one.tone === 'you' || one.tone === 'bad')
  return (
    <Popover
      label="This task’s parts"
      placement="below"
      align="end"
      width={330}
      padded={false}
      trigger={<ChromeButton icon="clip" label="Parts" count={parts.length} {...(waits ? { mark: 'Something waits on you' } : {})} />}
    >
      <PartsList parts={parts} />
    </Popover>
  )
}

/** D: the same button opens them beside the thread, where a wide window has room; open until closed. */
export function RailButton({ parts, open, onToggle }: { parts: ReadonlyArray<Part>; open: boolean; onToggle: () => void }) {
  return <ChromeButton icon="clip" label="Parts" count={parts.length} expanded={open} onClick={onToggle} />
}

export function PartsRail({ parts, onClose }: { parts: ReadonlyArray<Part>; onClose: () => void }) {
  return (
    <div className={s.railAnchor}>
      <aside className={s.rail} aria-label="This task’s parts">
        <PartsList parts={parts} onClose={onClose} />
      </aside>
    </div>
  )
}
