import { useState } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Caret } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { Select } from '../../primitives/Select/Select'
import { SettingRow } from '../Preferences/Preferences'
import s from './TaskFolders.module.css'

/*
 * When finished tasks' folders go, and what this computer's disk holds of them,
 * as one row of Work on this computer. The choice is at its end, Smart to start.
 * Under it, one bar of the disk: what the rest of the Mac uses, the folders
 * Althar holds back in a paler cobalt, and what could go now hatched. Its
 * legend says each in GB and opens a compact list, one line a folder: what
 * Clean up takes, then, below a hairline, what is held back, each with why
 * and its own Remove, which takes the place of its words and size on the row
 * the pointer is on and asks first, under the row, where something of the
 * person's goes with it. Clean up asks nothing: what it takes loses nothing
 * for good. Until each of a group's folders is measured, its figure is a
 * placeholder and its part of the bar is left out: a part never shows as the
 * whole. No violet: nothing here needs the person.
 */

/** When finished tasks' folders go: by how each task ended, or one wait for all, or only when the person cleans up. */
export type FolderWait = 'smart' | 'day' | 'week' | 'month' | 'never'

/** How a finished task ended, which its folder's wait goes by. */
export type FolderKind = 'merged' | 'done' | 'abandoned' | 'review'

/** Why a folder whose wait is up is held back: Althar won't remove it by itself. */
export type HeldWhy = 'uncommitted' | 'unpushed' | 'running' | 'opened' | 'unreadable'

export interface FinishedFolder {
  /** Its task, by id. */
  readonly id: string
  readonly title: string
  readonly kind: FolderKind
  /** When it finished, in words: 2 days ago. */
  readonly when: string
  /** On disk, in bytes; null until measured. */
  readonly bytes: number | null
}

export interface HeldFolder extends FinishedFolder {
  readonly why: HeldWhy
  /** How many: the files not committed, the commits never pushed. */
  readonly count?: number
}

export interface TaskFoldersText {
  title: string
  waits: Record<FolderWait, { readonly label: string; readonly note: string }>
  canGo: string
  held: string
  cleanUp: string
  /** What Clean up freed, measured after, in bytes. */
  freed: (bytes: number) => string
  /** The folders' sizes are still being worked out. */
  measuring: string
  /** What the legend opens, as a screen reader names it. */
  list: string
  goesHead: string
  heldHead: string
  why: Record<HeldWhy, string>
  /** What Remove says first, of what goes with a held-back folder or what stays. */
  ask: Record<Exclude<HeldWhy, 'running'>, (count: number) => string>
  remove: string
  removeAnyway: string
  cancel: string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** Bytes as GB, or MB under one: 2.3 GB, 14 GB, 640 MB, under 1 MB. */
const sizeOf = (bytes: number): string => {
  const gb = bytes / 1024 ** 3
  if (bytes < 1024 ** 2) return bytes === 0 ? '0 MB' : 'under 1 MB'
  if (gb < 1) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

export const taskFoldersText: TaskFoldersText = {
  title: 'Remove finished tasks’ folders',
  waits: {
    smart: {
      label: 'Smart',
      note: 'Reviews right away, merged after 3 days, done after a week, abandoned after 2 weeks. Sooner when space runs low.',
    },
    day: { label: 'After a day', note: 'A day after a task settles. Their branches stay.' },
    week: { label: 'After a week', note: 'A week after a task settles. Their branches stay.' },
    month: { label: 'After a month', note: 'A month after a task settles. Their branches stay.' },
    never: { label: 'Only when I clean up', note: 'Nothing goes by itself.' },
  },
  canGo: 'Can go now',
  held: 'Held back',
  cleanUp: 'Clean up',
  freed: (bytes) => `Freed ${sizeOf(bytes)} just now`,
  measuring: 'Measuring…',
  list: 'Finished tasks’ folders',
  goesHead: 'Goes with Clean up',
  heldHead: 'Held back',
  why: { uncommitted: 'Not committed', unpushed: 'Never pushed', running: 'Running', opened: 'Opened today', unreadable: 'Can’t be read' },
  ask: {
    uncommitted: (n) => `${plural(n, 'changed file goes', 'changed files go')} with it.`,
    unpushed: (n) => `Its ${plural(n, 'commit stays', 'commits stay')} on its branch, on this computer.`,
    opened: () => 'If an editor has it open, its files close there.',
    unreadable: () => 'Git can’t say what is in it: whatever is goes with it.',
  },
  remove: 'Remove',
  removeAnyway: 'Remove anyway',
  cancel: 'Cancel',
}

/** The choices, in the order the menu offers them. */
const WAITS: ReadonlyArray<FolderWait> = ['smart', 'day', 'week', 'month', 'never']

const KIND_GLYPH: Record<FolderKind, IconName> = { merged: 'check', done: 'check', abandoned: 'stop', review: 'answer' }

const WHY_GLYPH: Record<HeldWhy, IconName> = {
  uncommitted: 'pencil',
  unpushed: 'up',
  running: 'play',
  opened: 'external',
  unreadable: 'close',
}

/** What removing folders frees; null until each is measured, never a part as if it were the whole. */
const total = (folders: ReadonlyArray<FinishedFolder>) =>
  folders.reduce<number | null>((sum, one) => (sum === null || one.bytes === null ? null : sum + one.bytes), 0)

/** A total, or, until each of its folders is measured, a placeholder in its place. */
function Total({ bytes, t }: { bytes: number | null; t: TaskFoldersText }) {
  return bytes === null ? <span className={s.pending}>{t.measuring}</span> : <>{sizeOf(bytes)}</>
}

/** Removing it by hand loses something of the person's: its Remove is red. */
const loses = (why: HeldWhy) => why === 'uncommitted' || why === 'unreadable'

export interface TaskFoldersProps {
  wait: FolderWait
  onWait: (wait: FolderWait) => void
  /** This Mac's disk, in bytes: its size and what is used; null until read, which leaves the bar out. */
  disk: { readonly total: number; readonly used: number } | null
  /** Finished tasks' folders Clean up takes now: their wait isn't up yet, and nothing holds them. */
  goes: ReadonlyArray<FinishedFolder>
  /** Folders whose wait is up, which Althar holds back; each removed by hand, but while it runs. */
  held: ReadonlyArray<HeldFolder>
  onCleanUp: () => void
  onRemove: (id: string) => void
  /** Opens a folder's task from its row; without it, the rows only say. */
  onOpen?: (id: string) => void
  /** Their sizes are still being worked out. */
  measuring?: boolean
  /** What was freed just now, in bytes; null where nothing was. */
  freed?: number | null
  /** What is being removed: `clean`, everything Clean up takes, or one folder by its task's id. */
  busy?: string | null
  /** What went wrong, in words. */
  error?: string
  text?: Partial<TaskFoldersText>
}

/** A folder Clean up takes: how its task ended, its name, when, its size; pressed, where it can, it opens its task. */
function GoesRow({ one, onOpen }: { one: FinishedFolder; onOpen: ((id: string) => void) | undefined }) {
  const words = (
    <>
      <Icon name={KIND_GLYPH[one.kind]} size={11} className={cx(s.mark, one.kind === 'merged' && s.merged)} />
      <span className={s.title}>{one.title}</span>
      <span className={s.meta}>{one.when}</span>
      <span className={s.size}>{one.bytes === null ? '' : sizeOf(one.bytes)}</span>
    </>
  )
  return (
    <li>
      {onOpen === undefined ? (
        <div className={s.item}>{words}</div>
      ) : (
        <button type="button" className={cx(s.item, s.opens)} onClick={() => onOpen(one.id)}>
          {words}
        </button>
      )}
    </li>
  )
}

/** A folder held back: why as its glyph and words; Remove, but while it runs, asks first under the row. */
function HeldRow({
  one,
  asking,
  onAsk,
  onRemove,
  busy,
  t,
}: {
  one: HeldFolder
  asking: boolean
  onAsk: (asking: boolean) => void
  onRemove: () => void
  busy: boolean
  t: TaskFoldersText
}) {
  const removable = one.why !== 'running'
  return (
    <li className={cx(s.item, asking && s.asking, removable && !asking && s.removable)}>
      <Icon name={WHY_GLYPH[one.why]} size={11} className={cx(s.mark, s.warm)} />
      <span className={s.title}>{one.title}</span>
      <span className={cx(s.meta, s.why)} title={one.when}>
        {t.why[one.why]}
      </span>
      <span className={s.size}>{one.bytes === null ? '' : sizeOf(one.bytes)}</span>
      {removable && !asking && (
        <span className={s.act}>
          <Button size="small" variant="quiet" onClick={() => onAsk(true)}>
            {t.remove}
          </Button>
        </span>
      )}
      {asking && one.why !== 'running' && (
        <fieldset className={s.ask} aria-label={`${t.remove}: ${one.title}`}>
          <span className={s.askWords}>{t.ask[one.why](one.count ?? 0)}</span>
          <LinkButton onClick={() => onAsk(false)}>{t.cancel}</LinkButton>
          <Button size="small" variant={loses(one.why) ? 'danger' : 'default'} busy={busy} onClick={onRemove}>
            {loses(one.why) ? t.removeAnyway : t.remove}
          </Button>
        </fieldset>
      )}
    </li>
  )
}

/** What the legend opens: what Clean up takes, then, below a hairline, what is held back. */
function FolderList({
  goes,
  held,
  onRemove,
  onOpen,
  busy,
  t,
}: Pick<TaskFoldersProps, 'goes' | 'held' | 'onRemove' | 'onOpen' | 'busy'> & { t: TaskFoldersText }) {
  const [asking, setAsking] = useState<string | null>(null)
  return (
    <div className={s.list}>
      {goes.length > 0 && (
        <section className={s.section} aria-label={t.goesHead}>
          <div className={s.head}>
            <h3 className={s.eyebrow}>{t.goesHead}</h3>
            <span className={s.total}>
              <Total bytes={total(goes)} t={t} />
            </span>
          </div>
          <ul className={s.rows}>
            {goes.map((one) => (
              <GoesRow key={one.id} one={one} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
      {held.length > 0 && (
        <section className={cx(s.section, goes.length > 0 && s.apart)} aria-label={t.heldHead}>
          <div className={s.head}>
            <h3 className={s.eyebrow}>{t.heldHead}</h3>
            <span className={s.total}>
              <Total bytes={total(held)} t={t} />
            </span>
          </div>
          <ul className={s.rows}>
            {held.map((one) => (
              <HeldRow
                key={one.id}
                one={one}
                asking={asking === one.id}
                onAsk={(on) => setAsking(on ? one.id : null)}
                onRemove={() => onRemove(one.id)}
                busy={busy === one.id}
                t={t}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/**
 * When finished tasks' folders go, the choice at the row's end; under it
 * this computer's disk as one bar, its legend opening the folders, and Clean up.
 */
export function TaskFolders({
  wait,
  onWait,
  disk,
  goes,
  held,
  onCleanUp,
  onRemove,
  onOpen,
  measuring = false,
  freed = null,
  busy = null,
  error,
  text,
}: TaskFoldersProps) {
  const t = { ...taskFoldersText, ...text, waits: { ...taskFoldersText.waits, ...text?.waits } }
  const going = total(goes)
  const holding = total(held)
  const width = (n: number) => `${disk === null || disk.total === 0 ? 0 : (Math.max(0, n) / disk.total) * 100}%`
  const any = goes.length > 0 || held.length > 0
  return (
    <SettingRow
      title={t.title}
      note={t.waits[wait].note}
      glyph={<Icon name="folder" size={15} />}
      under={
        (disk !== null || any || measuring || freed !== null || error !== undefined) && (
          <div className={s.space}>
            {disk !== null && (
              <span className={s.bar} aria-hidden="true">
                <i className={s.others} style={{ width: width(disk.used - (going ?? 0) - (holding ?? 0)) }} />
                <i className={s.heldPart} style={{ width: width(holding ?? 0) }} />
                <i className={s.goesPart} style={{ width: width(going ?? 0) }} />
              </span>
            )}
            <span className={s.legend}>
              {any && (
                <Popover
                  label={t.list}
                  placement="below"
                  align="start"
                  width={480}
                  padded={false}
                  trigger={
                    <button type="button" className={s.keys}>
                      {goes.length > 0 && (
                        <span className={s.key}>
                          <i className={s.hatch} aria-hidden="true" />
                          {t.canGo}{' '}
                          <b>
                            <Total bytes={going} t={t} />
                          </b>
                        </span>
                      )}
                      {held.length > 0 && (
                        <span className={s.key}>
                          <i className={s.pale} aria-hidden="true" />
                          {t.held}{' '}
                          <b>
                            <Total bytes={holding} t={t} />
                          </b>
                        </span>
                      )}
                      <Caret />
                    </button>
                  }
                >
                  <FolderList goes={goes} held={held} onRemove={onRemove} {...(onOpen === undefined ? {} : { onOpen })} busy={busy} t={t} />
                </Popover>
              )}
              {measuring && going !== null && holding !== null && <span>{t.measuring}</span>}
              <span className={s.grow} />
              {freed !== null && <span>{t.freed(freed)}</span>}
              {goes.length > 0 && (
                <Button size="small" busy={busy === 'clean'} onClick={onCleanUp}>
                  {t.cleanUp}
                </Button>
              )}
            </span>
            {error !== undefined && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )
      }
    >
      {() => (
        <Select<FolderWait>
          label={t.title}
          value={wait}
          onChange={onWait}
          options={WAITS.map((value) => ({ value, label: t.waits[value].label }))}
          width={190}
        />
      )}
    </SettingRow>
  )
}
