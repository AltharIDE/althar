import { useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
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

export type SnippetProps = RootProps<
  'div',
  {
    cmd: string
    text?: Partial<SnippetText>
  }
>

/** A command to copy. A long one shows whole on request: you should see what you are about to paste. */
export function Snippet({ cmd, text, className, ...rest }: SnippetProps) {
  const t = { ...snippetText, ...text }
  const line = useRef<HTMLElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  /* whether it overflows changes with the width it is given, not only the command */
  useLayoutEffect(() => {
    const el = line.current
    if (!el) return
    const measure = () => setLong(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [cmd])
  return (
    <div className={cx(s.snippet, open && s.open, className)} data-rhythm={Rhythm.Snippet} {...rest}>
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
