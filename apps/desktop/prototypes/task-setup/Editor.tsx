// Scrappy: a few lines of shell to read and change in place: numbered, coloured, with what is typed laid over the colours.
import { type ReactNode, useRef, useState } from 'react'

import s from './editor.module.css'

/** What a word is, for its colour. */
type Kind = 'fn' | 'flag' | 'string' | 'comment' | 'punct' | 'var' | 'path' | 'copy'

/** Colours one line of shell: the program, its flags, strings, variables, comments, and what joins commands. */
export const shellLine = (line: string, copies = false): ReactNode[] => {
  const out: ReactNode[] = []
  const push = (kind: Kind | null, words: string) =>
    out.push(
      kind === null ? (
        words
      ) : (
        <span key={out.length} className={s[kind]}>
          {words}
        </span>
      ),
    )
  if (copies) {
    // A file from the checkout: its folders quiet, its name plain.
    const at = line.lastIndexOf('/')
    if (at >= 0) push('path', line.slice(0, at + 1))
    push(null, line.slice(at + 1))
    return out
  }
  const re = /(#.*$)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)|(&&|\|\||[|;])|(\s+)|([^\s"'|;&$#]+|[&$#])/g
  let first = true
  for (const m of line.matchAll(re)) {
    const [all, comment, string, variable, joint, space, word] = m
    if (comment !== undefined) push('comment', comment)
    else if (string !== undefined) push('string', string)
    else if (variable !== undefined) push('var', variable)
    else if (joint !== undefined) {
      push('punct', joint)
      first = true
    } else if (space !== undefined) push(null, space)
    else if (word !== undefined) {
      if (first) {
        push(word === 'copy' ? 'copy' : 'fn', word)
        first = false
      } else push(word.startsWith('-') ? 'flag' : null, word)
    } else push(null, all)
  }
  return out
}

export interface EditorProps {
  lines: ReadonlyArray<string> | null
  label: string
  placeholder?: string
  /** Lines that are files, not commands. */
  copies?: boolean
  /** Colours a line its own way, as one script with its copies does. */
  colour?: (line: string) => ReactNode[]
  tone?: 'paper' | 'term'
  onSave: (lines: ReadonlyArray<string>) => void
}

const linesOf = (words: string) =>
  words
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

export function Editor({ lines, label, placeholder, copies = false, colour, tone = 'paper', onSave }: EditorProps) {
  const [value, setValue] = useState((lines ?? []).join('\n'))
  const code = useRef<HTMLPreElement>(null)
  const rows = value.split('\n')
  return (
    <div className={tone === 'term' ? s.term : s.editor}>
      <div className={s.gutter} aria-hidden="true">
        {rows.map((_, at) => (
          <span key={at}>{at + 1}</span>
        ))}
      </div>
      <div className={s.body}>
        <pre ref={code} className={s.layer} aria-hidden="true">
          {rows.map((row, at) => (
            <span key={at} className={s.line}>
              {row === '' ? ' ' : colour !== undefined ? colour(row) : shellLine(row, copies)}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          className={s.input}
          aria-label={label}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={rows.length}
          value={value}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event) => setValue(event.target.value)}
          onScroll={(event) => {
            if (code.current !== null) code.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          onBlur={() => onSave(linesOf(value))}
        />
      </div>
    </div>
  )
}
