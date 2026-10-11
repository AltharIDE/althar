import s from './Ways.module.css'

export interface Way {
  href: string
  name: string
  note: string
}

/** Ways on from a page that has little of its own, such as the docs' place or a page that isn't there. */
export function Ways({ ways }: { ways: readonly Way[] }) {
  return (
    <ul className={s.ways}>
      {ways.map((way) => (
        <li key={way.href}>
          <a href={way.href}>
            <b>{way.name}</b>
            <span>{way.note}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
