import { type ComponentProps, useEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { SettingGroup } from '../Preferences/Preferences'
import s from './Storage.module.css'

/*
 * Where Althar keeps its data, and how big each place is (About › Storage),
 * as a tile each: the task folders, the profile and the logs, each with its
 * size, its share of the whole once every size is in, and the way to open it
 * in the system's file manager, whose tooltip says the path. The place that
 * can be freed leads, wider and in a well, with the way to free it. A size is
 * worked out away from the window and can take a while for task folders, so
 * it says it is being measured; one that ran out of time is an estimate, and
 * says so; a folder that isn't there says that. The figures are kept for the
 * session, and Measure again takes them anew.
 */

/** What measuring a place has come to. */
export type StorageFigure =
  | { readonly state: 'measuring' }
  | {
      readonly state: 'done'
      readonly bytes: number
      readonly approximate?: boolean
      readonly unreadable?: number
    }
  | { readonly state: 'missing' }
  | { readonly state: 'failed' }

export interface StoragePlaceRow {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly figure: StorageFigure
  /** Why it couldn't be opened, after a Show that failed. */
  readonly problem?: string
}

export interface StorageText {
  title: string
  measuring: string
  /** The size, in bytes, as words: 2.3 GB. */
  size: (bytes: number) => string
  /** The walk ran out of time, so the size is a lower bound: at least this much. */
  approximate: (size: string) => string
  /** Some entries couldn't be read and are left out of the size. */
  unreadable: (count: number) => string
  /** Opening the place failed, with what the system said. */
  couldntOpen: (why: string) => string
  missing: string
  failed: string
  /** Opens the place in the system's file manager: Show in Finder. */
  show: string
  /** Names a Show button for a screen reader: what it does, then the place. */
  showLabel: (show: string, place: string) => string
  /** A tile's share of all the places: 81%, or under 1%. */
  share: (fraction: number) => string
  /** Names a Copy path button: what it does, then the place. */
  copyPath: (place: string) => string
  /** Names the path, to select, where the clipboard refused it. */
  pathOf: (place: string) => string
  /** Where the place that can be freed is freed. */
  freeUp: string
  measureAgain: string
}

const unit = (bytes: number, power: number) => {
  const value = bytes / 1024 ** power
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

/** Bytes as words: 12 KB, 640 MB, 2.3 GB. */
export const storageSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${unit(bytes, 2)} MB`
  if (bytes < 1024 ** 4) return `${unit(bytes, 3)} GB`
  return `${unit(bytes, 4)} TB`
}

export const storageText: StorageText = {
  title: 'Storage',
  measuring: 'measuring…',
  size: storageSize,
  approximate: (size) => `at least ${size}`,
  couldntOpen: (why) => `Couldn’t open it: ${why}`,
  unreadable: (count) => (count === 1 ? '1 item couldn’t be read' : `${count} items couldn’t be read`),
  missing: 'not there yet',
  failed: 'couldn’t be measured',
  show: 'Show in Files',
  showLabel: (show, place) => `${show}, ${place}`,
  share: (fraction) => (fraction < 0.01 ? '<1%' : `${Math.round(fraction * 100)}%`),
  copyPath: (place) => `Copy path, ${place}`,
  pathOf: (place) => `Path, ${place}`,
  freeUp: 'Free up space',
  measureAgain: 'Measure again',
}

export interface StorageProps {
  places: ReadonlyArray<StoragePlaceRow>
  onShow: (id: string) => void
  onMeasureAgain: () => void
  /** The place that can be freed, by id, and where it is freed: it leads, with Free up space. */
  freeUp?: { readonly id: string; readonly onFreeUp: () => void }
  /** What Copy path writes to the clipboard with: the browser's by default. */
  copy?: (text: string) => Promise<void>
  text?: Partial<StorageText>
  /** The title's rank in the page's outline. */
  headingLevel?: ComponentProps<typeof SettingGroup>['headingLevel']
}

export function Storage({ places, onShow, onMeasureAgain, freeUp, copy, text, headingLevel }: StorageProps) {
  const t = { ...storageText, ...text }
  // The place whose path the clipboard refused (as in a window not allowed to write it): its path, to select.
  const [refused, setRefused] = useState<string | null>(null)
  const write = copy ?? clipboard
  const measuring = places.some((place) => place.figure.state === 'measuring')
  // A share only once every size is in, and whole: a part, or a lower bound, never shows as a share of the whole.
  const exact = (figure: StorageFigure) => figure.state === 'done' && figure.approximate !== true && (figure.unreadable ?? 0) === 0
  const sizes = places.map((place) => (place.figure.state === 'done' && exact(place.figure) ? place.figure.bytes : null))
  const whole = sizes.every((bytes) => bytes !== null) ? sizes.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0) : 0
  // The place that can be freed leads; the rest keep their order.
  const ordered = freeUp === undefined ? places : [...places].sort((a, b) => Number(b.id === freeUp.id) - Number(a.id === freeUp.id))
  return (
    <SettingGroup
      title={t.title}
      headingLevel={headingLevel}
      action={
        <LinkButton onClick={onMeasureAgain} disabled={measuring}>
          {t.measureAgain}
        </LinkButton>
      }
    >
      <ul className={s.tiles}>
        {ordered.map((place) => {
          const lead = freeUp?.id === place.id
          return (
            <li key={place.id} className={cx(s.tile, lead && s.lead)}>
              <span className={s.title}>{place.title}</span>
              {whole > 0 && place.figure.state === 'done' && <span className={s.share}>{t.share(place.figure.bytes / whole)}</span>}
              <Figure figure={place.figure} t={t} />
              {(place.problem !== undefined || refused === place.id) && (
                <span className={s.problem}>
                  {place.problem !== undefined && <span role="alert">{t.couldntOpen(place.problem)}</span>}
                  {/* The clipboard refused it: the path, selected, to copy by hand. */}
                  {refused === place.id && place.path !== '' ? (
                    <PathField path={place.path} label={t.pathOf(place.title)} />
                  ) : (
                    // The file manager didn't open: the path, to copy.
                    place.path !== '' && <span className={s.path}>{place.path}</span>
                  )}
                </span>
              )}
              <span className={s.actions}>
                {/* Nothing to free where the folder isn't there. */}
                {lead && place.figure.state !== 'missing' && (
                  <Button size="small" trailingIcon="arrow" onClick={freeUp.onFreeUp}>
                    {t.freeUp}
                  </Button>
                )}
                {place.path !== '' && (
                  <CopyButton
                    ghost
                    value={place.path}
                    text={{ copy: t.copyPath(place.title) }}
                    write={(path) =>
                      write(path).then(
                        () => setRefused((was) => (was === place.id ? null : was)),
                        (failure: unknown) => {
                          setRefused(place.id)
                          throw failure
                        },
                      )
                    }
                  />
                )}
                <Button
                  size="small"
                  icon="folder"
                  className={s.show}
                  disabled={place.figure.state === 'missing'}
                  aria-label={t.showLabel(t.show, place.title)}
                  title={place.path === '' ? t.show : `${t.show}: ${place.path}`}
                  onClick={() => onShow(place.id)}
                >
                  {''}
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </SettingGroup>
  )
}

const clipboard = (text: string) =>
  navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('No clipboard in this context'))

/** A path the clipboard refused, selected and focused as it appears, to copy by hand. */
function PathField({ path, label }: { path: string; label: string }) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  return (
    <input ref={field} className={cx(s.path, s.field)} readOnly value={path} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
  )
}

function Figure({ figure, t }: { figure: StorageFigure; t: StorageText }) {
  if (figure.state === 'measuring')
    return (
      <span className={cx(s.figure, s.quiet)} role="status">
        {t.measuring}
      </span>
    )
  if (figure.state === 'missing') return <span className={cx(s.figure, s.quiet)}>{t.missing}</span>
  if (figure.state === 'failed') return <span className={cx(s.figure, s.quiet)}>{t.failed}</span>
  const size = t.size(figure.bytes)
  const unreadable = figure.unreadable ?? 0
  // What ran out of time, or couldn't all be read, is a lower bound either way: its words before the size, smaller.
  const bound = figure.approximate === true || unreadable > 0
  const words = bound ? t.approximate(size) : size
  const at = bound ? words.lastIndexOf(size) : 0
  return (
    <span className={s.figure}>
      {bound && at > 0 && <small>{words.slice(0, at)}</small>}
      {bound && at > 0 ? size : words}
      {unreadable > 0 && <span className={s.fine}>{t.unreadable(unreadable)}</span>}
    </span>
  )
}
