import { useId, useState } from 'react'

import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Caret } from '../../primitives/Fold/Fold'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Markdown } from '../Markdown/Markdown'
import { useShell } from '../Shell/Shell'
import s from './Document.module.css'

const SHOWN = 5

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

export interface DocumentProps {
  title: string
  /** Markdown blocks. */
  body: string[]
  text?: Partial<DocumentText>
}

/** Markdown written into the thread itself, rendered, not a file. A long one folds, and can be read at full size in the side panel. */
export function Document({ title, body, text }: DocumentProps) {
  const t = { ...documentText, ...text }
  const { openDoc } = useShell()
  const [open, setOpen] = useState(false)
  const id = useId()
  const hidden = body.length - SHOWN
  return (
    <article className={cx(s.doc, open && s.open)} aria-label={title}>
      <div className={s.head}>
        <h3 className={s.title}>{title}</h3>
        <span className={s.actions}>
          <CopyButton value={body.join('\n\n')} text={t.copy} />
          <ActionButton icon="external" onClick={() => openDoc({ title, body })}>
            {t.sidePanel}
          </ActionButton>
        </span>
      </div>
      <div className={s.body} id={id}>
        <Markdown blocks={body.slice(0, SHOWN)} />
        {hidden > 0 && (
          /* the rest unfolds under what shows, as a Fold does */
          <div className={s.rest} data-state={open ? 'open' : 'closed'} inert={!open}>
            <div className={s.restInner}>
              <Markdown blocks={body.slice(SHOWN)} />
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
