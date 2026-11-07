import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import s from './PageFrame.module.css'

/*
 * Where a web page beside the conversation is drawn (ADR-099). The page
 * itself is the host's: a native view it lays over the window at the place
 * this measures, so nothing of the window's can draw over it. At a device's
 * size the page sits in a well, drawn whole and smaller where the panel is
 * smaller. While a menu of the window's is over it, or a comment is written
 * on it, the host shows a picture of the page in its place (`still`), and
 * the comment box is drawn on that picture, beside the element it is about.
 */

export interface PageBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type PageFrameProps = {
  /** The area the page may take, which the host measures to lay its view over. */
  placeRef?: Ref<HTMLDivElement>
  /** Where the page sits in that area, in its pixels, at a device's size; without it, the page fills the area. */
  page?: PageBox | null
  /** A picture of the page in its place, while something of the window's is over it. */
  still?: string | null
  /** The picture is drawn: the host's view can step aside now, with nothing seen to blink. */
  onStill?: () => void
  /** What shows where no page has loaded yet. */
  empty?: ReactNode
  /** Drawn over the page, in the area's pixels: a comment being written. */
  children?: ReactNode
  className?: string
}

export function PageFrame({ placeRef, page = null, still = null, onStill, empty, children, className }: PageFrameProps) {
  return (
    <div className={cx(s.frame, page !== null && s.well, className)}>
      <div ref={placeRef} className={s.place} />
      {empty !== undefined && <div className={s.empty}>{empty}</div>}
      {(still !== null || page !== null) && (
        <div
          className={cx(s.page, page === null && s.fill)}
          style={page === null ? undefined : { left: page.x, top: page.y, width: page.width, height: page.height }}
        >
          {still !== null && <img className={s.still} src={still} alt="" draggable={false} onLoad={onStill} />}
        </div>
      )}
      {children}
    </div>
  )
}

/** Where no page has loaded yet: what will be here, and how it gets here. */
export function PageEmpty({ children }: { children: ReactNode }) {
  return (
    <div className={s.emptyState}>
      <Icon name="globe" size={18} className={s.emptyIcon} />
      <p>{children}</p>
    </div>
  )
}

export interface CommentBoxText {
  /** The box's name, for assistive technology. */
  label: (element: string) => string
  placeholder: string
  add: string
  save: string
  cancel: string
  remove: string
}

export const commentBoxText: CommentBoxText = {
  label: (element) => `Comment on ${element}`,
  placeholder: 'What should change here?',
  add: 'Comment',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',
}

export interface CommentBoxProps {
  /** The element, where it is in the frame: outlined, with the box beside it. */
  at: PageBox
  /** The frame's size, to keep the box inside it. */
  room: { readonly width: number; readonly height: number }
  /** The number the comment has, or will have, in the composer and on its pin. */
  n: number
  /** The element at a glance, `span.needs`, and its size, `282 × 16`. */
  element: string
  size: string
  defaultValue?: string
  /** A comment made before, written again: Save and Remove rather than Comment. */
  existing?: boolean
  onSubmit: (note: string) => void
  onCancel: () => void
  onRemove?: () => void
  text?: Partial<CommentBoxText>
}

const WIDTH = 300
const TALL = 132
const GAP = 8

/** Where the box goes: under the element where it fits, else over it, else inside the frame's foot; across, lined up with it and kept in. */
export const boxPlace = (at: PageBox, room: { readonly width: number; readonly height: number }) => {
  const width = Math.min(WIDTH, Math.max(160, room.width - GAP * 2))
  const x = Math.max(GAP, Math.min(at.x, room.width - width - GAP))
  const below = at.y + at.height + GAP
  const above = at.y - GAP - TALL
  const y = below + TALL <= room.height - GAP ? below : above >= GAP ? above : Math.max(GAP, room.height - TALL - GAP)
  return { x, y, width }
}

/** A comment written on an element of the page: Enter adds it, Shift-Enter starts a new line, Escape leaves it. */
export function CommentBox({
  at,
  room,
  n,
  element,
  size,
  defaultValue = '',
  existing = false,
  onSubmit,
  onCancel,
  onRemove,
  text,
}: CommentBoxProps) {
  const t = { ...commentBoxText, ...text }
  const [note, setNote] = useState(defaultValue)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = field.current
    if (input === null) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  const place = boxPlace(at, room)
  const submit = () => {
    const said = note.trim()
    if (said !== '') onSubmit(said)
  }
  return (
    <>
      <div className={s.outline} style={{ left: at.x, top: at.y, width: at.width, height: at.height }} aria-hidden="true">
        <span className={s.name}>
          {element}
          <span className={s.size}>{size}</span>
        </span>
      </div>
      <form
        className={s.box}
        style={cssVars({ '--x': `${place.x}px`, '--y': `${place.y}px`, '--w': `${place.width}px` })}
        aria-label={t.label(element)}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <span className={s.n} aria-hidden="true">
          {n}
        </span>
        <textarea
          ref={field}
          className={s.field}
          value={note}
          rows={3}
          placeholder={t.placeholder}
          aria-label={t.label(element)}
          data-own-escape=""
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onCancel()
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <span className={s.actions}>
          {existing && onRemove !== undefined && (
            <Button variant="quiet" size="small" className={s.remove} onClick={onRemove}>
              {t.remove}
            </Button>
          )}
          <Button variant="quiet" size="small" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button variant="signal" size="small" type="submit" disabled={note.trim() === ''}>
            {existing ? t.save : t.add}
          </Button>
        </span>
      </form>
    </>
  )
}
