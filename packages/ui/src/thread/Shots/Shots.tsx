import { useId, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Caret } from '../../primitives/Fold/Fold'
import { ImageView, type ImageViewText } from '../Lightbox/Lightbox'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './Shots.module.css'

export interface ShotsText {
  label: string
  view: (name: string) => string
  /** The button that shows the rest of a long set. */
  showAll: (count: number) => string
  showFewer: string
  image: Partial<ImageViewText>
}

export const shotsText: ShotsText = {
  label: 'Screenshots',
  view: (name) => `View ${name} full size`,
  showAll: (count) => `Show all ${count}`,
  showFewer: 'Show fewer',
  image: {},
}

export type ShotsProps = RootProps<
  'div',
  {
    items: readonly (ImageRef & { id: string })[]
    /** How many show before the rest wait behind Show all. Four by default. */
    shown?: number
    text?: Partial<ShotsText>
  }
>

/**
 * Pictures the agent made: screenshots of what it built, before and after.
 * Side by side at a readable size, each from its smaller copy; each opens
 * full size when the host has a lightbox, with the others a key away. A long
 * set shows its first few and the rest on request. With none, nothing shows.
 */
export function Shots({ items, shown = 4, text, className, ...rest }: ShotsProps) {
  const t = { ...shotsText, ...text }
  const { openImage } = useThreadShell()
  const [all, setAll] = useState(false)
  const list = useId()
  if (items.length === 0) return null
  const long = items.length > shown
  const visible = long && !all ? items.slice(0, shown) : items
  return (
    <div className={cx(s.wrap, className)} {...rest}>
      <ul id={list} className={cx(s.shots, items.length === 1 && s.one)} aria-label={t.label}>
        {visible.map((it) => {
          const name = it.label ?? it.name
          const inner = (
            <>
              <span className={s.image}>
                <ImageView image={it} fit="cover" size="thumb" text={t.image} />
              </span>
              <span className={s.caption}>
                <span className={s.title}>{name}</span>
                {it.meta && <span className={s.meta}>{it.meta}</span>}
              </span>
            </>
          )
          return (
            <li key={it.id}>
              {openImage && it.status !== 'failed' ? (
                <button type="button" className={s.shot} onClick={() => openImage(it, items)} aria-label={t.view(name)}>
                  {inner}
                </button>
              ) : (
                <figure className={cx(s.shot, s.still)}>{inner}</figure>
              )}
            </li>
          )
        })}
      </ul>
      {long && (
        <button type="button" className={s.more} aria-expanded={all} aria-controls={list} onClick={() => setAll(!all)}>
          {all ? t.showFewer : t.showAll(items.length)}
          <Caret open={all} />
        </button>
      )}
    </div>
  )
}
