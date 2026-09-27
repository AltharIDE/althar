import { useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Rhythm } from '../../lib/rhythm'
import s from './Snippet.module.css'

export interface SnippetText {
  showAll: string
  less: string
  copy: Partial<CopyButtonText>
}

export const snippetText: SnippetText = { showAll: 'Show all', less: 'Less', copy: { copy: 'Copy command' } }

export interface SnippetProps {
  cmd: string
  text?: Partial<SnippetText>
}

/** A command to copy. A long one shows whole on request: you should see what you are about to paste. */
export function Snippet({ cmd, text }: SnippetProps) {
  const t = { ...snippetText, ...text }
  const line = useRef<HTMLElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = line.current
    if (el) setLong(el.scrollWidth > el.clientWidth + 1)
  }, [cmd])
  return (
    <div className={cx(s.snippet, open && s.open)} data-rhythm={Rhythm.Snippet}>
      <span className={s.prompt} aria-hidden="true">
        $
      </span>
      <code className={s.text} ref={line}>
        {cmd}
      </code>
      <span className={s.actions}>
        {(long || open) && (
          <ActionButton icon="chevronD" aria-expanded={open} className={s.toggle} onClick={() => setOpen(!open)}>
            {open ? t.less : t.showAll}
          </ActionButton>
        )}
        <CopyButton value={cmd} text={t.copy} ghost />
      </span>
    </div>
  )
}
