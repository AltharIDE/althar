import { You as KitYou } from '@althar/ui'
import type { ComponentProps } from 'react'

import { useLab } from './state'
import s from './slash.module.css'

/*
 * The kit, as the thread takes it in the lab: what the person said reads as
 * they typed it, but a command they sent (A, C) reads as one, as it did in
 * the field: A's token, C's cobalt.
 */
export * from '@althar/ui'

const COMMAND = /^(\/goal(?:\s+(?:pause|resume|clear|edit))?)(?=\s|$)([\s\S]*)$/i

export function You(props: ComponentProps<typeof KitYou>) {
  const { d } = useLab()
  const said = props.children
  const command = typeof said === 'string' && (d === 'a' || d === 'c') ? COMMAND.exec(said) : null
  if (command === null) return <KitYou {...props} />
  return (
    <KitYou {...props}>
      <span className={d === 'a' ? s.token : s.typed}>{command[1]}</span>
      {command[2]}
    </KitYou>
  )
}
