import { useId, useMemo, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Caret } from '../../primitives/Fold/Fold'
import { below, Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Markdown, markdownBlocks } from '../Markdown/Markdown'
import { useThreadShell } from '../Shell/Shell'
import s from './Document.module.css'

export interface DocumentText {
  sidePanel: string
  showAll: (hidden: number) => string
  showLess: string
  copy: Partial<CopyButtonText>
}

export const documentText: DocumentText = {
  sidePanel: 'Side panel',
  showAll: (n) => `Show all · ${n} more blocks`,
  showLess: 'Show less',
  copy: { copy: 'Copy markdown' },
}

export type DocumentProps = RootProps<
  'article',
  {
    title: string
    /** The document, as markdown. */
    body: string
    /** How many blocks show before it folds. */
    shown?: number
    /** The title's rank in the page's outline; the document's own headings go below it. */
    headingLevel?: HeadingLevel
    text?: Partial<DocumentText>
  }
>

/**
 * Markdown written into the thread itself, rendered, not a file. A long one
 * folds, and can be read at full size in the side panel when the shell can
 * open documents.
 */
export function Document({ title, body, shown = 5, headingLevel = 3, text, className, ...rest }: DocumentProps) {
  const t = { ...documentText, ...text }
  const { openDoc } = useThreadShell()
  const [open, setOpen] = useState(false)
  const id = useId()
  const hidden = useMemo(() => markdownBlocks(body), [body]) - shown
  const inner = below(headingLevel)
  return (
    <article className={cx(s.doc, open && s.open, className)} aria-label={title} {...rest}>
      <div className={s.head}>
        <Heading level={headingLevel} className={s.title}>
          {title}
        </Heading>
        <span className={s.actions}>
          <CopyButton value={body} text={t.copy} />
          {openDoc && (
            <ActionButton icon="external" onClick={() => openDoc({ title, body })}>
              {t.sidePanel}
            </ActionButton>
          )}
        </span>
      </div>
      <div className={s.body} id={id}>
        <Markdown source={body} to={shown} headingLevel={inner} />
        {hidden > 0 && (
          /* the rest unfolds under what shows, as a Fold does */
          <div className={s.rest} data-state={open ? 'open' : 'closed'} inert={!open}>
            <div className={s.restInner}>
              <Markdown source={body} from={shown} headingLevel={inner} />
            </div>
          </div>
        )}
      </div>
      {hidden > 0 && (
        <button type="button" className={s.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {open ? t.showLess : t.showAll(hidden)}
          <Caret open={open} />
        </button>
      )}
    </article>
  )
}
