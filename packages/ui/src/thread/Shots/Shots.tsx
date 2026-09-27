import { cx } from '../../lib/cx'
import { useShell, type ImageRef } from '../Shell/Shell'
import s from './Shots.module.css'

export interface ShotsText {
  label: string
  view: (name: string) => string
}

export const shotsText: ShotsText = { label: 'Screenshots', view: (name) => `View ${name} full size` }

export interface ShotsProps {
  items: ImageRef[]
  text?: Partial<ShotsText>
}

/** Pictures the agent made: screenshots of what it built, before and after. Side by side at a readable size; each opens full size. */
export function Shots({ items, text }: ShotsProps) {
  const t = { ...shotsText, ...text }
  const { openImage } = useShell()
  return (
    <ul className={cx(s.shots, items.length === 1 && s.one)} aria-label={t.label}>
      {items.map((it) => (
        <li key={it.name}>
          <button type="button" className={s.shot} onClick={() => openImage(it)} aria-label={t.view(it.label ?? it.name)}>
            <span className={s.image}>{it.view}</span>
            <span className={s.caption}>
              <span className={s.title}>{it.label ?? it.name}</span>
              {it.meta && <span className={s.meta}>{it.meta}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
