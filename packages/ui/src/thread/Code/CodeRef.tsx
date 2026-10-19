import { type MouseEvent, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Code } from '../../primitives/Code/Code'
import { Popover } from '../../primitives/Popover/Popover'
import { useThreadShell } from '../Shell/Shell'
import { type FoundCode, linesOf, nameOf } from './code'
import s from './Code.module.css'

export interface CodeRefText {
  /** The name's button, for a screen reader: what it opens. */
  open: (where: string) => string
}

export const codeRefText: CodeRefText = { open: (where) => `Open ${where}` }

export interface CodeRefProps {
  found: FoundCode
  /** Written into the words without backticks: it stays words, underlined. */
  plain?: boolean
  text?: Partial<CodeRefText>
}

/** What the name says on its chip: the file's name and lines, the name in code as written, or the name of one that isn't there. */
function Label({ found }: { found: FoundCode }) {
  if (found.kind === 'file' && found.symbol !== undefined) return <span>{found.name}</span>
  const name = found.kind === 'several' ? nameOf(found.name.replace(/(:\d.*|#L.*)$/, '')) : nameOf(found.path)
  const lines = found.kind === 'missing' ? '' : linesOf(found.line, found.end)
  return (
    <>
      <Icon name="file" size={11} />
      <span>
        {name}
        {lines !== '' && <span className={s.refLines}>{lines}</span>}
      </span>
    </>
  )
}

/**
 * A name in what an agent wrote that names code, as its host found it:
 * pointed at, a peek at its lines; pressed, the file beside the thread, or
 * closed again there; ⌘-pressed, in the person's editor. Without a host
 * for code it is code text, as before.
 */
export function CodeRef({ found, plain = false, text }: CodeRefProps) {
  const t = { ...codeRefText, ...text }
  const code = useThreadShell().code
  const [peek, setPeek] = useState(false)
  if (code === undefined) return plain ? found.name : <Code>{found.name}</Code>
  const open = code.opened === found.name
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    // A press opens it; it doesn't toggle the peek, which the pointer opens.
    event.preventDefault()
    setPeek(false)
    if ((event.metaKey || event.ctrlKey) && found.kind === 'file' && code.openInEditor !== undefined) code.openInEditor(found)
    else if (open && code.close !== undefined) code.close()
    else code.open(found, event.currentTarget)
  }
  const where = found.kind === 'several' ? found.name : `${found.path}${found.kind === 'file' ? linesOf(found.line, found.end) : ''}`
  const chip = (
    <button
      type="button"
      className={
        plain ? s.plain : cx(s.ref, found.kind === 'missing' && s.missing, found.kind === 'file' && found.symbol !== undefined && s.symbol)
      }
      data-code-ref={found.name}
      data-open={open || undefined}
      aria-label={t.open(where)}
      onClick={onClick}
    >
      {plain ? found.name : <Label found={found} />}
    </button>
  )
  return (
    <Popover
      trigger={chip}
      label={where}
      hover
      // Not while it is open beside: the panel shows it already.
      open={peek && !open}
      onOpenChange={setPeek}
      padded={false}
      initialFocus="panel"
      placement="below"
      width={620}
      className={s.peek}
    >
      {peek && !open && code.peek(found)}
    </Popover>
  )
}
