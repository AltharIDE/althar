import type { KeyboardEvent, ReactNode, SyntheticEvent } from 'react'

import { EmptyState, Icon, type IconName } from '@althar/ui'

import { canCall } from '../../data/client'
import { useServices } from '../../data/services'
import s from './Homes.module.css'
import { useHomeName } from './useHomes'

/*
 * A part of a screen as the window's home lets this window have it. A home
 * says which calls a window on another computer may make (`GetConnectionInfo`'s
 * `calls`), and the window shows no more than that: where the home won't show a
 * part, a calm line on what is there and still works there; where it shows it
 * but won't take a change from here, the part as it stands, unchangeable, under
 * one quiet line. Never an error, and never a placeholder waiting on a read
 * that won't come. In this computer's own window every call is the window's,
 * and the part is just itself.
 */

export const holdsText = {
  cantChange: (home: string) => `This window can’t change these on ${home} yet.`,
}

/** Why a part isn't shown, before what still holds there: the same words wherever it is. */
export const farText = (what: 'it' | 'them') => `A window on another computer can’t show ${what} yet.`

/** What a part is, said where the home doesn't show it: what isn't shown, and what still holds there. */
export interface Unshown {
  readonly icon: IconName
  readonly title: (home: string) => string
  readonly line: string
}

/** Keys that move between controls: the rest, a held part keeps from the controls in it. */
const PASSING = new Set(['Tab', 'Escape'])
const stop = (event: SyntheticEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * A part shown as it stands, with nothing in it to change: its native controls disabled, and every press and key that
 * would reach one of its own (a slider drawn from a div, a row dragged into place) kept from it before it arrives.
 */
export function Held({ children }: { children: ReactNode }) {
  return (
    <fieldset
      disabled
      className={s.held}
      onPointerDownCapture={stop}
      onClickCapture={stop}
      onKeyDownCapture={(event: KeyboardEvent) => {
        if (!PASSING.has(event.key)) stop(event)
      }}
    >
      {children}
    </fieldset>
  )
}

export function HomeHolds({
  reads = [],
  changes = [],
  unshown,
  children,
}: {
  /** The calls the part reads what it shows with: without any of them, it isn't shown. */
  reads?: ReadonlyArray<string>
  /** The calls its changes make: without any of them, it is shown as it stands. */
  changes?: ReadonlyArray<string>
  unshown: Unshown
  children: ReactNode
}) {
  const { client } = useServices()
  const { remote, name } = useHomeName()
  if (!remote) return <>{children}</>
  if (reads.some((tag) => !canCall(client, tag)))
    return <EmptyState variant="flush" icon={unshown.icon} title={unshown.title(name)} line={unshown.line} />
  if (changes.every((tag) => canCall(client, tag))) return <>{children}</>
  return (
    <div className={s.holds}>
      <p className={s.holdsLine}>
        <Icon name="lock" size={13} className={s.holdsIcon} />
        {holdsText.cantChange(name)}
      </p>
      <Held>{children}</Held>
    </div>
  )
}
