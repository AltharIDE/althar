import type { ComponentProps } from 'react'

import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { SettingGroup, SettingList, SettingRow } from '../Preferences/Preferences'
import s from './Storage.module.css'

/*
 * Where Althar keeps its data, and how big each place is (About › Storage):
 * the profile, the logs and the task folders, each with its path, its size and
 * the way to open it in the system's file manager. A size is worked out away
 * from the window and can take a while for task folders, so it says it is being
 * measured; one that ran out of time is an estimate, and says so; a folder
 * that isn't there says that. The figures are kept for the session, and
 * Measure again takes them anew.
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
  /** What is kept there. */
  readonly note: string
  readonly path: string
  readonly figure: StorageFigure
  /** Why it couldn't be opened, after a Show that failed. */
  readonly problem?: string
}

export interface StorageText {
  title: string
  note: string
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
  /** Names a Show button for a screen reader: the visible text first, then the place. */
  showLabel: (show: string, place: string) => string
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
  note: 'Where Althar keeps its data on this computer.',
  measuring: 'measuring…',
  size: storageSize,
  approximate: (size) => `at least ${size}`,
  couldntOpen: (why) => `Couldn’t open it: ${why}`,
  unreadable: (count) => (count === 1 ? '1 item couldn’t be read' : `${count} items couldn’t be read`),
  missing: 'not there yet',
  failed: 'couldn’t be measured',
  show: 'Show in Files',
  showLabel: (show, place) => `${show}, ${place}`,
  measureAgain: 'Measure again',
}

export interface StorageProps {
  places: ReadonlyArray<StoragePlaceRow>
  onShow: (id: string) => void
  onMeasureAgain: () => void
  text?: Partial<StorageText>
  /** The title's rank in the page's outline. */
  headingLevel?: ComponentProps<typeof SettingGroup>['headingLevel']
}

export function Storage({ places, onShow, onMeasureAgain, text, headingLevel }: StorageProps) {
  const t = { ...storageText, ...text }
  const measuring = places.some((place) => place.figure.state === 'measuring')
  return (
    <SettingGroup
      title={t.title}
      headingLevel={headingLevel}
      note={t.note}
      action={
        <LinkButton onClick={onMeasureAgain} disabled={measuring}>
          {t.measureAgain}
        </LinkButton>
      }
    >
      <SettingList>
        {places.map((place) => (
          <SettingRow key={place.id} title={place.title} note={<Path place={place} t={t} />}>
            {() => (
              <>
                <Figure figure={place.figure} t={t} />
                <Button
                  size="small"
                  icon="folder"
                  disabled={place.figure.state === 'missing'}
                  aria-label={t.showLabel(t.show, place.title)}
                  onClick={() => onShow(place.id)}
                >
                  {t.show}
                </Button>
              </>
            )}
          </SettingRow>
        ))}
      </SettingList>
    </SettingGroup>
  )
}

function Path({ place, t }: { place: StoragePlaceRow; t: StorageText }) {
  return (
    <>
      {place.note}
      <span className={s.path} title={place.path}>
        {place.path}
      </span>
      {place.problem !== undefined && (
        <span className={s.problem} role="alert">
          {t.couldntOpen(place.problem)}
        </span>
      )}
    </>
  )
}

function Figure({ figure, t }: { figure: StorageFigure; t: StorageText }) {
  if (figure.state === 'measuring')
    return (
      <span className={s.figure} role="status">
        {t.measuring}
      </span>
    )
  if (figure.state === 'missing') return <span className={s.figure}>{t.missing}</span>
  if (figure.state === 'failed') return <span className={s.figure}>{t.failed}</span>
  const size = t.size(figure.bytes)
  const unreadable = figure.unreadable ?? 0
  // What ran out of time, or couldn't all be read, is a lower bound either way.
  return (
    <span className={s.figure}>
      {figure.approximate === true || unreadable > 0 ? t.approximate(size) : size}
      {unreadable > 0 && <span className={s.fine}>{t.unreadable(unreadable)}</span>}
    </span>
  )
}
