import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import s from './CodeBlock.module.css'
import { tokens } from './tokens'

export interface CodeBlockText {
  /** The block's name when it has no file. */
  label: (lang: string) => string
  lines: (from: number, to: number) => string
  changed: (n: number) => string
  open: string
  openTitle: (where: string) => string
  copy?: Partial<CopyButtonText>
}

export const codeBlockText: CodeBlockText = {
  label: (lang) => `${lang} code`,
  lines: (from, to) => `lines ${from}–${to}`,
  changed: (n) => `${n} changed`,
  open: 'Open in editor',
  openTitle: (where) => `Open ${where} in the editor`,
}

export interface CodeBlockProps {
  code: string
  lang: string
  /** Where it lives. Without a file it is a snippet with only its language. */
  file?: string
  /** The first line's number. */
  line?: number
  /** Lines that changed, by their position in the block, from 1. */
  highlight?: number[]
  /** Open the file in the editor. Without it, or without a file, there is no such button. */
  onOpen?: () => void
  text?: Partial<CodeBlockText>
}

/** Code the agent showed: numbered, coloured, with its file and the lines that changed. */
export function CodeBlock({ code, lang, file, line = 1, highlight = [], onOpen, text }: CodeBlockProps) {
  const t = { ...codeBlockText, ...text }
  const lines = code.split('\n')
  const name = file?.split('/').pop()
  return (
    <figure className={s.block} aria-label={file ?? t.label(lang)}>
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
              {highlight.length > 0 && (
                <>
                  {' · '}
                  <span className={s.changed}>{t.changed(highlight.length)}</span>
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
            <ActionButton icon="external" onClick={onOpen} title={t.openTitle(`${file}:${line}`)}>
              {t.open}
            </ActionButton>
          )}
        </span>
      </figcaption>
      <pre className={s.code} tabIndex={0}>
        {lines.map((l, i) => (
          <span key={i} className={cx(s.line, highlight.includes(i + 1) && s.hl)}>
            <span className={s.n} aria-hidden="true">
              {i + line}
            </span>
            <span>{l ? tokens(l) : ' '}</span>
            {'\n'}
          </span>
        ))}
      </pre>
    </figure>
  )
}
