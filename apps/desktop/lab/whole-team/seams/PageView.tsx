import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { CommentBox, PageFrame, PageLine, PagePanel, Segmented } from '@althar/ui'

import type { Where } from '../../../src/renderer/features/browser/pages'
import { pages } from '../../../src/renderer/features/browser/pages'
import { gather, useComments } from '../../../src/renderer/shared/comments'
import { lab, useLab } from '../state'
import s from './team.module.css'

/*
 * The page beside a conversation, in the lab: the app the team works on,
 * running from the task's own copy (the lab's `?app`, the app's own window
 * on an empty project), in the kit's PagePanel and PageFrame as the app
 * draws a page. Comment points at it as the app does: what is under the
 * pointer is outlined, a press opens the kit's CommentBox there, and what
 * is written goes into the conversation's composer with the app's own
 * comments (shared/comments.ts), as a pointed-at page's does.
 *
 * In B, a Before and After under the bar: the app as it is on main, and
 * with the task's change in.
 */

/** The app laid out at this size, then drawn as large as the panel lets it. */
const LAID = { width: 1180, height: 820 }

interface Pointed {
  readonly at: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly label: string
  readonly words: string
  readonly size: { readonly width: number; readonly height: number }
}

/** What a press points at: the nearest element that says something of its own, as the app's picker finds it. */
const pointable = (target: Element | null): Element | null => {
  let at = target
  while (at !== null && at.tagName !== 'BODY') {
    const box = at.getBoundingClientRect()
    if ((at.textContent ?? '').trim() !== '' && box.width > 40 && box.height > 14) return at
    at = at.parentElement
  }
  return null
}

export function PageView({
  owner,
  kind,
  draft,
  onDock,
}: {
  owner: string
  kind: 'task' | 'project'
  draft: string
  where: Where
  onDock: () => void
}) {
  const { d, m } = useLab()
  // Maya's change is in: once Maya has asked for it (A, 3) and in Maya's task (B, D), on After.
  const [shownSide, setSide] = useState<'before' | 'after'>('after')
  const after = (d === 'a' && m === 2) || (kind === 'task' && shownSide === 'after')
  const [pointing, setPointing] = useState(false)
  const [writing, setWriting] = useState<Pointed | null>(null)
  const comments = useComments(draft)
  const frame = useRef<HTMLIFrameElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  const [room, setRoom] = useState({ width: 600, height: 600 })

  useLayoutEffect(() => {
    const place = area.current
    if (place === null) return
    const observer = new ResizeObserver(() => {
      const box = place.getBoundingClientRect()
      setRoom({ width: box.width, height: box.height })
      setScale(Math.min(box.width / LAID.width, 1))
    })
    observer.observe(place)
    return () => observer.disconnect()
  }, [])

  // Pointing: what is under the pointer in the page is outlined; a press opens a comment on it.
  useEffect(() => {
    const doc = frame.current?.contentDocument
    if (!pointing || doc == null) return
    let outlined: HTMLElement | null = null
    const outline = (element: HTMLElement | null) => {
      if (outlined !== null) outlined.style.outline = ''
      outlined = element
      if (element !== null) {
        element.style.outline = '2px solid var(--signal)'
        element.style.outlineOffset = '2px'
      }
    }
    const over = (event: MouseEvent) => outline(pointable(event.target as Element) as HTMLElement | null)
    const press = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const element = pointable(event.target as Element)
      outline(null)
      setPointing(false)
      if (element === null) return
      const box = element.getBoundingClientRect()
      setWriting({
        at: { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale },
        label: `“${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32)}”`,
        words: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        size: { width: Math.round(box.width), height: Math.round(box.height) },
      })
    }
    doc.addEventListener('mouseover', over, true)
    doc.addEventListener('click', press, true)
    return () => {
      outline(null)
      doc.removeEventListener('mouseover', over, true)
      doc.removeEventListener('click', press, true)
    }
  }, [pointing, scale])

  const submit = (note: string) => {
    if (writing === null) return
    gather(draft, {
      id: `c${Date.now()}`,
      note,
      on: {
        kind: 'page',
        address: ADDRESS,
        viewport: 'fit',
        picked: {
          selector: writing.label,
          label: writing.label,
          text: writing.words,
          rect: {
            x: Math.round(writing.at.x / scale),
            y: Math.round(writing.at.y / scale),
            width: writing.size.width,
            height: writing.size.height,
          },
          font: '13px Inter',
          colour: 'rgb(36, 33, 28)',
          background: 'rgb(250, 248, 244)',
          page: LAID,
        },
      },
      crop: null,
    })
    setWriting(null)
  }

  return (
    <PagePanel
      address={ADDRESS}
      full={`http://${ADDRESS}`}
      canBack={false}
      canForward={false}
      onBack={() => undefined}
      onForward={() => undefined}
      onReload={() => frame.current?.contentWindow?.location.reload()}
      onNavigate={() => undefined}
      keep="until the task is done"
      onClear={() => undefined}
      viewport="fit"
      viewports={[{ value: 'fit', label: 'Fit the panel' }]}
      onViewport={() => undefined}
      onComment={() => setPointing((now) => !now)}
      pointing={pointing}
      docked="beside"
      onDock={onDock}
      onClose={() => {
        pages.hide(owner)
        if (d === 'a') lab.set({ m: 0 })
      }}
      line={
        kind === 'task' ? (
          <div className={s.sides}>
            <Segmented
              label="Which app"
              value={shownSide}
              onChange={setSide}
              options={[
                { value: 'before', label: 'On main' },
                { value: 'after', label: 'With this change' },
              ]}
            />
            <span className={s.sidesNote}>Your copy, running</span>
          </div>
        ) : kind === 'project' && m === 1 && comments.length === 0 && !pointing ? (
          <PageLine icon="comment">Press Comment, then the part of the app you’d change.</PageLine>
        ) : null
      }
      text={{ label: 'Page', sessionTitle: kind === 'task' ? 'This task’s own session' : 'The project’s own session' }}
    >
      <PageFrame>
        <div ref={area} className={s.previewArea} data-pointing={pointing || undefined}>
          <iframe
            ref={frame}
            key={after ? 'after' : 'before'}
            className={s.preview}
            title="althar, running"
            src={`/?app=1${after ? '&after=1' : ''}`}
            style={{ width: LAID.width, height: room.height / scale, transform: `scale(${scale})` }}
          />
        </div>
        {writing !== null && (
          <CommentBox
            at={writing.at}
            room={room}
            n={comments.length + 1}
            element={writing.label}
            size={`${writing.size.width} × ${writing.size.height}`}
            onSubmit={submit}
            onCancel={() => setWriting(null)}
          />
        )}
      </PageFrame>
    </PagePanel>
  )
}

const ADDRESS = 'localhost:5174'
