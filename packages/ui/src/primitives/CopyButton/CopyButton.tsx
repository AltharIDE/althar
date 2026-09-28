import { useEffect, useState } from 'react'

import { unreachable } from '../../foundations/vocabulary'
import type { IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../ActionButton/ActionButton'
import { Tooltip } from '../HoverCard/HoverCard'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './CopyButton.module.css'

export interface CopyButtonText {
  /** The button's name, and its label when not ghost. */
  copy: string
  copied: string
  failed: string
}

export const copyButtonText: CopyButtonText = { copy: 'Copy', copied: 'Copied', failed: 'Couldn’t copy' }

export type CopyButtonProps = RootProps<
  'button',
  {
    /** What goes on the clipboard. */
    value: string
    text?: Partial<CopyButtonText>
    /** Icon only until it has copied; the label is still read out. */
    ghost?: boolean
    tone?: 'default' | 'onDark'
    /** It copied. */
    onCopy?: (value: string) => void
    /** What writes to the clipboard: the browser's by default; a desktop shell may pass its own. */
    write?: (text: string) => Promise<void>
  }
>

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
export function CopyButton({
  value,
  text,
  ghost = false,
  tone = 'default',
  onCopy,
  write = clipboard,
  className,
  onClick,
  ...rest
}: CopyButtonProps) {
  const [result, setResult] = useState<Result>('idle')
  /* each press starts the moment again, even when it already says Copied */
  const [press, setPress] = useState(0)
  useEffect(() => {
    if (result === 'idle') return
    const t = window.setTimeout(() => setResult('idle'), 1400)
    return () => window.clearTimeout(t)
  }, [result, press])

  const t = { ...copyButtonText, ...text }
  const { said, icon } = look(result, t)
  const show = !ghost || result !== 'idle'
  const button = (
    <ActionButton
      icon={icon}
      tone={tone}
      className={cx(s.copy, result === 'done' && s.done, result === 'failed' && s.failed, className)}
      {...rest}
      onClick={(e) => {
        onClick?.(e)
        write(value).then(
          () => {
            setResult('done')
            setPress((n) => n + 1)
            onCopy?.(value)
          },
          () => {
            setResult('failed')
            setPress((n) => n + 1)
          },
        )
      }}
      {...(show ? { children: said } : { 'aria-label': t.copy })}
    />
  )
  return (
    <>
      {/* a ghost shows only its glyph, so it names itself in a tooltip */}
      {ghost ? <Tooltip label={t.copy}>{button}</Tooltip> : button}
      <span aria-live="polite">{result !== 'idle' && <VisuallyHidden>{said}</VisuallyHidden>}</span>
    </>
  )
}
