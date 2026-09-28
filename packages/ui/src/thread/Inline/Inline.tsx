import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { HoverCard, Tooltip } from '../../primitives/HoverCard/HoverCard'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Inline.module.css'

export interface FileRefText {
  /** The button's name: where is the path and line. */
  open: (where: string) => string
}

export const fileRefText: FileRefText = { open: (where) => `Open ${where} in the editor` }

export interface FileRefProps {
  path: string
  line?: number
  /** Open it in the editor. Without it, the reference is text. */
  onOpen?: () => void
  className?: string
  text?: Partial<FileRefText>
}

/** A file in running text: its name, with the whole path on hover. Opens it in the editor when it can. Sits on the text's baseline. */
export function FileRef({ path, line, onOpen, className, text }: FileRefProps) {
  const t = { ...fileRefText, ...text }
  const name = path.split('/').pop() ?? path
  const where = `${path}${line !== undefined ? `:${line}` : ''}`
  const body = (
    <>
      <Icon name="file" size={11} />
      <span>
        {name}
        {line !== undefined && <span className={s.line}>:{line}</span>}
      </span>
    </>
  )
  if (!onOpen)
    return (
      <span className={cx(s.ref, s.still, className)}>
        <VisuallyHidden>{path.slice(0, -name.length)}</VisuallyHidden>
        {body}
      </span>
    )
  return (
    <Tooltip label={where}>
      <button type="button" className={cx(s.ref, className)} aria-label={t.open(where)} onClick={onOpen}>
        {body}
      </button>
    </Tooltip>
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
