import { useEffect, useState } from 'react'

import { unreachable } from '../../foundations/vocabulary'
import type { IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../ActionButton/ActionButton'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './CopyButton.module.css'

export interface CopyButtonText {
  /** The button's name, and its label when not ghost. */
  copy: string
  copied: string
  failed: string
}

export const copyButtonText: CopyButtonText = { copy: 'Copy', copied: 'Copied', failed: 'Couldn’t copy' }

export interface CopyButtonProps {
  /** What goes on the clipboard. */
  value: string
  text?: Partial<CopyButtonText>
  /** Icon only until it has copied; the label is still read out. */
  ghost?: boolean
  tone?: 'default' | 'onDark'
  className?: string
  /** For tests and stories: what writes to the clipboard. */
  write?: (text: string) => Promise<void>
}

type Result = 'idle' | 'done' | 'failed'

function look(result: Result, t: CopyButtonText): { said: string; icon: IconName } {
  switch (result) {
    case 'idle':
      return { said: t.copy, icon: 'copy' }
    case 'done':
      return { said: t.copied, icon: 'check' }
    case 'failed':
      return { said: t.failed, icon: 'close' }
    default:
      return unreachable(result)
  }
}

const clipboard = (text: string) => {
  if (!navigator.clipboard) return Promise.reject(new Error('No clipboard in this context'))
  return navigator.clipboard.writeText(text)
}

/** Copies, then says so for a moment. If the clipboard refuses, it says that instead. */
export function CopyButton({ value, text, ghost = false, tone = 'default', className, write = clipboard }: CopyButtonProps) {
  const [result, setResult] = useState<Result>('idle')
  useEffect(() => {
    if (result === 'idle') return
    const t = window.setTimeout(() => setResult('idle'), 1400)
    return () => window.clearTimeout(t)
  }, [result])

  const t = { ...copyButtonText, ...text }
  const { said, icon } = look(result, t)
  const show = !ghost || result !== 'idle'
  return (
    <>
      <ActionButton
        icon={icon}
        tone={tone}
        className={cx(s.copy, result === 'done' && s.done, result === 'failed' && s.failed, className)}
        aria-label={show ? undefined : t.copy}
        title={t.copy}
        onClick={(e) => {
          e.stopPropagation()
          write(value).then(
            () => setResult('done'),
            () => setResult('failed'),
          )
        }}
      >
        {show ? said : undefined}
      </ActionButton>
      <span aria-live="polite">{result !== 'idle' && <VisuallyHidden>{said}</VisuallyHidden>}</span>
    </>
  )
}
