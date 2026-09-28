import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ImageView } from '../Lightbox/Lightbox'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './Shots.module.css'

export interface ShotsText {
  label: string
  view: (name: string) => string
}

export const shotsText: ShotsText = { label: 'Screenshots', view: (name) => `View ${name} full size` }

export type ShotsProps = RootProps<
  'ul',
  {
    items: readonly (ImageRef & { id: string })[]
    text?: Partial<ShotsText>
  }
>

/** Pictures the agent made: screenshots of what it built, before and after. Side by side at a readable size; each opens full size when the host has a lightbox. */
export function Shots({ items, text, className, ...rest }: ShotsProps) {
  const t = { ...shotsText, ...text }
  const { openImage } = useThreadShell()
  return (
    <ul className={cx(s.shots, items.length === 1 && s.one, className)} aria-label={t.label} {...rest}>
      {items.map((it) => {
        const inner = (
          <>
            <span className={s.image}>
              <ImageView image={it} fit="cover" />
            </span>
            <span className={s.caption}>
              <span className={s.title}>{it.label ?? it.name}</span>
              {it.meta && <span className={s.meta}>{it.meta}</span>}
            </span>
          </>
        )
        return (
          <li key={it.id}>
            {openImage ? (
              <button type="button" className={s.shot} onClick={() => openImage(it)} aria-label={t.view(it.label ?? it.name)}>
                {inner}
              </button>
            ) : (
              <figure className={cx(s.shot, s.still)}>{inner}</figure>
            )}
          </li>
        )
      })}
    </ul>
  )
}
