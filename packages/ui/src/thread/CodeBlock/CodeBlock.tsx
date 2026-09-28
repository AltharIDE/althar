import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './CodeBlock.module.css'
import { scriptLike, scriptTokens } from './tokens'

export interface CodeBlockText {
  /** The block's name when it has no file. */
  label: (lang: string) => string
  lines: (from: number, to: number) => string
  changed: (n: number) => string
  /** Read before a changed line, for a screen reader. */
  changedLine: string
  open: string
  copy?: Partial<CopyButtonText>
}

export const codeBlockText: CodeBlockText = {
  label: (lang) => `${lang} code`,
  lines: (from, to) => `lines ${from}–${to}`,
  changed: (n) => `${n} changed`,
  changedLine: 'changed:',
  open: 'Open in editor',
}

/** Colours one line of code. Return the line as nodes; plain text is fine. */
export type Highlighter = (line: string, lang: string) => ReactNode

export type CodeBlockProps = RootProps<
  'figure',
  {
    code: string
    /** The language, as a name to show and a hint to the highlighter: "TypeScript", "ts", "Shell". */
    lang: string
    /** Where it lives. Without a file it is a snippet with only its language. */
    file?: string
    /** The first line's number. */
    line?: number
    /** Lines that changed, by their position in the block, from 1. */
    changed?: readonly number[]
    /** Colours each line. By default TypeScript and JavaScript are coloured and other languages are plain. */
    highlight?: Highlighter
    /** Open the file in the editor. Without it, or without a file, there is no such button. */
    onOpen?: () => void
    text?: Partial<CodeBlockText>
  }
>

const builtIn: Highlighter = (line, lang) => (scriptLike(lang) ? scriptTokens(line) : line)

/** Code the agent showed: numbered, coloured, with its file and the lines that changed. */
export function CodeBlock({
  code,
  lang,
  file,
  line = 1,
  changed = [],
  highlight = builtIn,
  onOpen,
  text,
  className,
  ...rest
}: CodeBlockProps) {
  const t = { ...codeBlockText, ...text }
  const lines = code.split('\n')
  const name = file?.split('/').pop()
  const marked = new Set(changed)
  return (
    <figure className={cx(s.block, className)} aria-label={file ?? t.label(lang)} {...rest}>
      <figcaption className={s.head}>
        {file && name ? (
          <>
            <Icon name="file" size={12} className={s.icon} />
            <span className={s.file}>
              <span className={s.dir}>{file.slice(0, -name.length)}</span>
              {name}
            </span>
            <span className={s.lang}>
              {lang} · {t.lines(line, line + lines.length - 1)}
              {marked.size > 0 && (
                <>
                  {' · '}
                  <span className={s.changed}>{t.changed(marked.size)}</span>
                </>
              )}
            </span>
          </>
        ) : (
          <span className={s.lang}>{lang}</span>
        )}
        <span className={s.actions}>
          <CopyButton value={code} text={t.copy} />
          {file && onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </span>
      </figcaption>
      <pre className={s.code} tabIndex={0}>
        {lines.map((l, i) => {
          const hl = marked.has(i + 1)
          return (
            <span key={i} className={cx(s.line, hl && s.hl)}>
              <span className={s.n} aria-hidden="true">
                {i + line}
              </span>
              <span>
                {hl && <VisuallyHidden>{t.changedLine} </VisuallyHidden>}
                {l ? highlight(l, lang) : ' '}
              </span>
              {'\n'}
            </span>
          )
        })}
      </pre>
    </figure>
  )
}
