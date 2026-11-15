import { useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { ellipsisOf, foldersToDrop, partsOf } from '../../lib/shortPath'
import s from './Path.module.css'

/*
 * A path, shortened where its room is narrow by whole folders from its
 * start, never by part of a name: "…/tests/coordinatorTools.test.ts". It
 * measures what the browser drew, so it holds for any font and as the room
 * is resized. Give it the room by where you put it (a grid column, a flex
 * item with the rest fixed); it asks for what the whole path needs.
 *
 * The whole path stays in the page, as text: the folders that gave way are
 * only out of sight, so a screen reader, a button's name and a copy all have
 * it, and two files that shorten alike are still told apart.
 */

export interface PathProps {
  /** Folders and a file: "packages/runtime/src/Coordinator.ts"; or a folder, with its slash or not: "packages/runtime/src". Windows paths too. */
  path: string
  /** The folders in front. */
  dirClassName?: string
  /** What the path ends with: the file's name, or the last folder. */
  nameClassName?: string
  className?: string
  /** Show the whole path on hover; on by default. */
  hover?: boolean
}

/** What a path shows now: its "…/" and the folders in view, then its end; not the folders out of sight. */
export function visiblePath(path: Element): string {
  const shown = path.firstElementChild
  return shown === null
    ? ''
    : [...shown.children]
        .filter((one) => !one.hasAttribute('data-out'))
        .map((one) => one.textContent)
        .join('')
}

export function Path({ path, dirClassName, nameClassName, className, hover = true }: PathProps) {
  const { folders, end } = partsOf(path)
  const root = useRef<HTMLSpanElement>(null)
  const whole = useRef<HTMLSpanElement>(null)
  const [dropped, setDropped] = useState(0)
  const mark = ellipsisOf(folders)

  useLayoutEffect(() => {
    const room = root.current
    const all = whole.current
    if (!room || !all || folders.length === 0) return
    const measure = () => {
      const widths = [...all.children].map((one) => one.getBoundingClientRect().width)
      const ellipsis = widths.shift() ?? 0
      const last = widths.pop() ?? 0
      setDropped(foldersToDrop(widths, last, ellipsis, room.getBoundingClientRect().width))
    }
    measure()
    // A font arriving makes the path wider without its room changing.
    void document.fonts?.ready.then(measure)
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(room)
    return () => watch.disconnect()
  }, [path, folders.length])

  const out = Math.min(dropped, folders.length)
  return (
    <span ref={root} className={cx(s.path, className)} title={hover ? path : undefined}>
      <span className={s.shown}>
        {out > 0 && (
          <span className={dirClassName} aria-hidden="true">
            {mark}
          </span>
        )}
        {out === 0 && dirClassName === nameClassName ? (
          <span className={nameClassName}>{path}</span>
        ) : (
          <>
            {folders.map((folder, at) => (
              <span key={at} className={cx(dirClassName, at < out && s.out)} {...(at < out ? { 'data-out': '' } : {})}>
                {folder}
              </span>
            ))}
            <span className={nameClassName}>{end}</span>
          </>
        )}
      </span>
      {/* Whole, after it (rows line up by the first), and not seen: its folders each apart, drawn from their text so they are measured and not found as text. */}
      <span ref={whole} className={s.whole} aria-hidden="true">
        <span className={dirClassName} data-text={mark} />
        {folders.map((folder, at) => (
          <span key={at} className={dirClassName} data-text={folder} />
        ))}
        <span className={nameClassName} data-text={end} />
      </span>
    </span>
  )
}
