import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { Code } from '../../primitives/Code/Code'
import s from './Markdown.module.css'

/** Inline code in a line of text: `like this`. */
export const inline = (t: string): ReactNode[] =>
  t
    .split(/(`[^`]+`)/)
    .map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <Code key={i}>{part.slice(1, -1)}</Code> : part))

/**
 * A small markdown: headings, lists, code, quotes, paragraphs. One string
 * per block. The reading voice of the thread, a size down.
 */
export function Markdown({ blocks, size = 'thread' }: { blocks: string[]; size?: 'thread' | 'panel' }) {
  return (
    <div className={cx(s.md, size === 'panel' && s.panel)}>
      {blocks.map((b, i) => {
        if (b.startsWith('## ')) return <h4 key={i}>{b.slice(3)}</h4>
        if (b.startsWith('# ')) return <h3 key={i}>{b.slice(2)}</h3>
        if (b.startsWith('- '))
          return (
            <ul key={i}>
              {b.split('\n').map((l) => (
                <li key={l}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          )
        if (b.startsWith('```')) return <pre key={i}>{b.replace(/```\w*\n?/g, '')}</pre>
        if (b.startsWith('> ')) return <blockquote key={i}>{inline(b.slice(2))}</blockquote>
        return <p key={i}>{inline(b)}</p>
      })}
    </div>
  )
}
