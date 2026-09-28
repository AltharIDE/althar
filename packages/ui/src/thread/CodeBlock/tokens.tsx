import type { ReactNode } from 'react'

import s from './CodeBlock.module.css'

/*
 * A small tokenizer for TypeScript and JavaScript, coloured in inks that stay
 * out of the way of the product's own colours (cobalt, violet, the diff's
 * green and red). Enough for a readable excerpt; not a parser. Other
 * languages show plain unless the host passes its own highlighter.
 */

const KW = new Set(
  'import export from const let var function return if else for while await async new class extends type interface default of in as throw try catch'.split(
    ' ',
  ),
)
const RE = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"`]+)/g

type Kind = 'keyword' | 'string' | 'number' | 'fn' | 'key' | 'comment' | 'punct' | null

function kindOf(match: RegExpExecArray, line: string): Kind {
  const [t, comment, str, num, id] = match
  if (comment) return 'comment'
  if (str) return 'string'
  if (num) return 'number'
  if (id) {
    if (KW.has(id)) return 'keyword'
    const rest = line.slice(match.index + t.length)
    if (/^\s*\(/.test(rest)) return 'fn'
    if (/^\s*:/.test(rest)) return 'key'
    return null
  }
  return /^\s+$/.test(t) ? null : 'punct'
}

const SCRIPT = new Set(['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript', 'mjs', 'cjs'])

/** Whether the built-in colouring knows the language. */
export const scriptLike = (lang: string) => SCRIPT.has(lang.toLowerCase())

/** One line of TypeScript or JavaScript, coloured. */
export function scriptTokens(line: string): ReactNode[] {
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
