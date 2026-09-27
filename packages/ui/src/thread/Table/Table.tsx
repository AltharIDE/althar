import type { ReactNode } from 'react'

import s from './Table.module.css'

export interface TableProps {
  head: string[]
  /** The first cell of each row names it, and is set in mono. */
  rows: ReactNode[][]
  caption?: string
  text?: Partial<TableText>
}

export interface TableText {
  /** The region's name when there is no caption. */
  label: string
}

export const tableText: TableText = { label: 'Table' }

/** A small table the agent wrote: results, a comparison. It scrolls sideways rather than squeezing. */
export function Table({ head, rows, caption, text }: TableProps) {
  const t = { ...tableText, ...text }
  return (
    <div className={s.wrap} tabIndex={0} role="region" aria-label={caption ?? t.label}>
      <table className={s.table}>
        {caption && <caption className={s.caption}>{caption}</caption>}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className={s.first}>
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
