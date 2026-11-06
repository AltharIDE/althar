// Scrappy: a page, as Althar's browser shows it: an <iframe> standing in for Electron's WebContentsView, its links followed in place,
// and, while the person points, the element under the pointer outlined, a comment written on it, and a numbered pin where each was left.
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '../../../src/primitives/Button/Button'
import { Tooltip } from '../../../src/primitives/HoverCard/HoverCard'
import { cx } from '../../../src/lib/cx'
import { followed } from '../addresses'
import { type Comment, proto, useProto } from '../state'
import s from './Frame.module.css'
import { find, labelOf, selectorOf, textOf } from './point'

/** Where the page is drawn in the frame: how much smaller, how far in from the left, and how far it is scrolled. */
export interface Place {
  readonly scale: number
  readonly left: number
  readonly scrollY: number
  readonly width: number
  readonly height: number
}

export interface FrameProps {
  scope: string
  address: string
  src: string
  reloads: number
  /** A link in the page was followed: where it goes. */
  onFollow: (address: string) => void
  /** Pointing at it gathers comments: false for main's side in C. */
  pointable?: boolean
  /** The page's own width, where it isn't the frame's: 1280 drawn smaller, or a phone's 390. */
  pageWidth?: number | null
  /** The page's own height, where it is a viewport of its own (a screenshot's), drawn smaller to fit. */
  pageHeight?: number | null
  /** Where it is scrolled to, where another frame leads it. */
  scrollY?: number | null
  onScroll?: (y: number) => void
  onTitle?: (title: string) => void
  /** The page's document, once loaded: what C compares. */
  onDoc?: (doc: Document) => void
  /** Drawn over the page, in its place: a screenshot laid over it, the lead's pointer. */
  layer?: (place: Place) => ReactNode
  className?: string
  style?: CSSProperties
  /** For the page's own frame: the swipe clips it. */
  pageStyle?: CSSProperties
  /** Draws nothing over it but the page: main's side under the task's. */
  bare?: boolean
}

const PIN = 20

export function Frame({
  scope,
  address,
  src,
  reloads,
  onFollow,
  pointable = true,
  pageWidth = null,
  pageHeight = null,
  scrollY = null,
  onScroll,
  onTitle,
  onDoc,
  layer,
  className,
  style,
  pageStyle,
  bare = false,
}: FrameProps) {
  const p = useProto()
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [, setTick] = useState(0)
  const [scrolled, setScrolled] = useState(0)
  const [hover, setHover] = useState<Element | null>(null)
  // The elements stepped out through with ↑, to step back in with ↓.
  const inner = useRef<Element[]>([])
  const follow = useRef(onFollow)
  const at = useRef(address)
  const told = useRef(onScroll)
  const led = useRef(scrollY)
  useLayoutEffect(() => {
    follow.current = onFollow
    at.current = address
    told.current = onScroll
    led.current = scrollY
  })

  useEffect(() => {
    const element = box.current
    if (element === null) return
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(element)
    return () => resized.disconnect()
  }, [])

  const width = pageWidth ?? size.w
  const scale =
    size.w === 0
      ? 1
      : pageHeight !== null
        ? Math.min(1, size.w / width, size.h / pageHeight)
        : pageWidth !== null && pageWidth > size.w
          ? size.w / pageWidth
          : 1
  const left = Math.max(0, (size.w - width * scale) / 2)
  const height = pageHeight ?? (scale === 0 ? size.h : size.h / scale)
  const doc = () => frame.current?.contentDocument ?? null
  const win = () => frame.current?.contentWindow ?? null

  // The page, once loaded: its links go through Althar's browser, its scroll is told, its title read.
  const loaded = useCallback(() => {
    const page = frame.current?.contentDocument
    const view = frame.current?.contentWindow
    if (page == null || view == null) return
    page.documentElement.style.scrollBehavior = 'auto'
    page.addEventListener(
      'click',
      (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null
        const href = link?.getAttribute('href')
        if (href == null || href.startsWith('#')) return
        event.preventDefault()
        follow.current(followed(at.current, href))
      },
      true,
    )
    view.open = ((url?: string | URL) => {
      if (url !== undefined) follow.current(followed(at.current, String(url)))
      return null
    }) as typeof view.open
    view.addEventListener('scroll', () => {
      setScrolled(view.scrollY)
      told.current?.(view.scrollY)
    })
    view.addEventListener('resize', () => setTick((n) => n + 1))
    // The site draws after its load event: where it is led to scroll, it goes once there is page enough to scroll.
    for (const wait of [300, 900]) {
      window.setTimeout(() => {
        onTitle?.(page.title)
        onDoc?.(page)
        if (led.current !== null && Math.abs(view.scrollY - led.current) > 1) view.scrollTo(0, led.current)
        setTick((n) => n + 1)
      }, wait)
    }
  }, [onTitle, onDoc])

  // Led by another frame: scrolled where it is.
  useEffect(() => {
    const view = win()
    if (view === null || scrollY === null) return
    if (Math.abs(view.scrollY - scrollY) > 1) view.scrollTo(0, scrollY)
  }, [scrollY])

  const pointing = pointable && p.pointing === scope
  const draft = p.draft !== null && p.draft.scope === scope && p.draft.address === address ? p.draft : null
  const comments = p.comments.filter((one) => one.scope === scope && one.address === address)

  // While pointing: ↑ steps out to the element round it, ↓ back in, Escape stops.
  useEffect(() => {
    if (!pointing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (p.draft !== null) proto.cancel()
        else proto.point(null)
      } else if (event.key === 'ArrowUp' && hover?.parentElement != null && hover.parentElement !== doc()?.body) {
        event.preventDefault()
        inner.current.push(hover)
        setHover(hover.parentElement)
      } else if (event.key === 'ArrowDown' && inner.current.length > 0) {
        event.preventDefault()
        setHover(inner.current.pop() ?? null)
      }
    }
    // Ahead of the screen's own keys: Escape here stops pointing, and doesn't also leave the task.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pointing, hover, p.draft])
  useEffect(() => {
    if (!pointing) setHover(null)
  }, [pointing])

  /** Where an element is in the frame, from where it is in the page. */
  const placed = (el: Element) => {
    const rect = el.getBoundingClientRect()
    return { left: left + rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale }
  }

  const under = (clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect()
    const page = doc()
    if (rect === undefined || page === null) return null
    const found = page.elementFromPoint((clientX - rect.left - left) / scale, (clientY - rect.top) / scale)
    return found === null || found === page.documentElement || found === page.body ? null : found
  }

  const pick = (el: Element) => {
    const view = win()
    if (view === null || frame.current === null) return
    const rect = el.getBoundingClientRect()
    proto.pick({
      scope,
      address,
      src,
      selector: selectorOf(el),
      label: labelOf(el),
      text: textOf(el),
      box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      viewport: { w: view.innerWidth, h: view.innerHeight },
      scroll: view.scrollY,
    })
  }

  const lit = hover === null ? null : placed(hover)
  const drafted = draft === null ? null : find(doc(), draft.selector)
  const draftAt = drafted === null ? null : placed(drafted)
  const place: Place = { scale, left, scrollY: scrolled, width, height }

  return (
    <div
      ref={box}
      className={cx(s.frame, ((pageWidth !== null && pageWidth * scale < size.w - 1) || pageHeight !== null) && s.narrow, className)}
      style={style}
    >
      <iframe
        key={`${src}#${reloads}`}
        ref={frame}
        src={src}
        title={address}
        className={s.page}
        onLoad={loaded}
        style={{ width, height, left, transform: scale === 1 ? undefined : `scale(${scale})`, ...pageStyle }}
      />
      {!bare && layer?.(place)}
      {!bare &&
        comments.map((one, n) => (
          <Pin
            key={one.id}
            comment={one}
            n={p.comments.filter((each) => each.scope === scope).indexOf(one) + 1 || n + 1}
            at={find(doc(), one.selector)}
            placed={placed}
            bounds={size}
          />
        ))}
      {pointing && (
        <div
          className={s.pointing}
          onMouseMove={(event) => {
            if (draft !== null) return
            const found = under(event.clientX, event.clientY)
            if (found !== hover && !inner.current.includes(found as Element)) {
              inner.current = []
              setHover(found)
            }
          }}
          onMouseLeave={() => draft === null && setHover(null)}
          onWheel={(event) => win()?.scrollBy(0, event.deltaY / scale)}
          onClick={(event) => {
            if (draft !== null) return proto.cancel()
            const found = hover ?? under(event.clientX, event.clientY)
            if (found !== null) pick(found)
          }}
        >
          {lit !== null && draft === null && hover !== null && (
            <div className={s.lit} style={lit}>
              <span className={cx(s.tag, lit.top < 22 && s.tagInside)}>{labelOf(hover)}</span>
            </div>
          )}
        </div>
      )}
      {draft !== null && draftAt !== null && (
        <>
          <div className={s.held} style={draftAt} />
          <Draft
            key={`${draft.selector}${draft.editing ?? ''}`}
            at={draftAt}
            frame={size}
            label={draft.label}
            text={draft.text}
            editing={draft.editing}
            note={draft.editing === undefined ? '' : (p.comments.find((one) => one.id === draft.editing)?.note ?? '')}
          />
        </>
      )}
    </div>
  )
}

function Pin({
  comment,
  n,
  at,
  placed,
  bounds,
}: {
  comment: Comment
  n: number
  at: Element | null
  placed: (el: Element) => { left: number; top: number; width: number; height: number }
  bounds: { w: number; h: number }
}) {
  if (at === null) return null
  const where = placed(at)
  const left = Math.min(Math.max(2, where.left + where.width - PIN / 2), bounds.w - PIN - 4)
  const top = Math.min(Math.max(2, where.top - PIN / 2), bounds.h - PIN - 4)
  return (
    <Tooltip label={comment.note} placement="below">
      <button
        type="button"
        className={s.pin}
        style={{ left, top }}
        aria-label={`Comment ${n}: ${comment.note}`}
        onClick={() => proto.edit(comment.id)}
      >
        {n}
      </button>
    </Tooltip>
  )
}

const CARD = 360

/** The comment being written, beside the element it is on, kept inside the frame: Enter adds it, Shift-Enter a new line, Escape puts it away. */
function Draft({
  at,
  frame,
  label,
  text,
  note,
  editing,
}: {
  at: { left: number; top: number; width: number; height: number }
  frame: { w: number; h: number }
  label: string
  text: string
  note: string
  editing: string | undefined
}) {
  const [written, setWritten] = useState(note)
  const [missing, setMissing] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus(), [])
  const below = at.top + at.height + 8
  const top = below + 160 < frame.h ? below : Math.max(8, at.top - 168)
  const left = Math.min(Math.max(8, at.left), Math.max(8, frame.w - CARD - 8))
  const add = () => {
    if (written.trim() === '') {
      setMissing(true)
      return field.current?.focus()
    }
    proto.add(written.trim())
  }
  return (
    <form
      className={s.draft}
      style={{ top, left, width: CARD }}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <div className={s.what}>
        <code>{label}</code>
        {text !== '' && <span>{text}</span>}
      </div>
      <textarea
        ref={field}
        className={cx(s.note, missing && s.missing)}
        rows={2}
        value={written}
        placeholder={missing ? 'Write a comment first' : 'Comment'}
        aria-label="Comment"
        onChange={(event) => {
          setWritten(event.target.value)
          setMissing(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            add()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            proto.cancel()
          }
        }}
      />
      <div className={s.draftActions}>
        {editing !== undefined && (
          <Button variant="danger" size="small" onClick={() => proto.remove(editing)}>
            Remove
          </Button>
        )}
        <span className={s.grow} />
        <Button variant="quiet" size="small" onClick={() => proto.cancel()}>
          Cancel
        </Button>
        <Button type="submit" size="small">
          {editing === undefined ? 'Add' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
