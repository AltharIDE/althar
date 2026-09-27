import type { ReactNode } from 'react'

import s from './CodeBlock.module.css'

/*
 * A small tokenizer for TypeScript-like code, coloured in inks that stay out
 * of the way of the product's own colours (cobalt, violet, the diff's green
 * and red). Enough for a readable excerpt; not a parser.
 */

const KW = new Set(
  'import export from const let var function return if else for while await async new class extends type interface default of in as throw try catch'.split(
    ' ',
  ),
)
const RE = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"`]+)/g

type Kind = 'keyword' | 'string' | 'number' | 'fn' | 'key' | 'comment' | 'punct' | null

export function kindOf(match: RegExpExecArray, line: string): Kind {
  const [t, comment, str, num, id] = match
  if (comment) return 'comment'
  if (str) return 'string'
  if (num) return 'number'
  if (id) {
    const rest = line.slice(match.index + t.length)
    return KW.has(id) ? 'keyword' : /^\s*\(/.test(rest) ? 'fn' : /^\s*:/.test(rest) ? 'key' : null
  }
  return /^\s+$/.test(t) ? null : 'punct'
}

export function tokens(line: string): ReactNode[] {
  const out: ReactNode[] = []
  for (const m of line.matchAll(RE)) {
    const k = kindOf(m, line)
    out.push(
      k ? (
        <span key={out.length} className={s[k]}>
          {m[0]}
        </span>
      ) : (
        m[0]
      ),
    )
  }
  return out
}
