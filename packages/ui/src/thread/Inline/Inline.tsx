import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import s from './Inline.module.css'

export interface FileRefText {
  /** The button's name: where is the path and line. */
  open: (where: string) => string
}

export const fileRefText: FileRefText = { open: (where) => `Open ${where} in the editor` }

export interface FileRefProps {
  path: string
  line?: number
  onOpen?: () => void
  text?: Partial<FileRefText>
}

/** A file in running text. Opens it in the editor. Sits on the text's baseline. */
export function FileRef({ path, line, onOpen, text }: FileRefProps) {
  const t = { ...fileRefText, ...text }
  const name = path.split('/').pop()
  const where = `${path}${line ? `:${line}` : ''}`
  return (
    <button type="button" className={s.ref} title={t.open(where)} aria-label={t.open(where)} onClick={onOpen}>
      <Icon name="file" size={11} />
      <span>
        {name}
        {line && <span className={s.line}>:{line}</span>}
      </span>
    </button>
  )
}

export interface CiteText {
  /** The citation's name. */
  source: (n: number) => string
}

export const citeText: CiteText = { source: (n) => `Source ${n}` }

export interface CiteProps {
  n: number
  /** Where the claim comes from. */
  children: ReactNode
  text?: Partial<CiteText>
}

/** A numbered citation. Where the claim comes from shows on hover or focus. */
export function Cite({ n, children, text }: CiteProps) {
  const t = { ...citeText, ...text }
  return (
    <HoverCard card={children} width={260} placement="above">
      <button type="button" className={s.cite} aria-label={t.source(n)}>
        {n}
      </button>
    </HoverCard>
  )
}
