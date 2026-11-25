import { useEffect, useState } from 'react'

import { UpdateHome } from '@althar/ui/screens'

import { LAST_WITHOUT_SETTING_UP } from '../../../homes'
import s from './Homes.module.css'
import { useHomeName, useHomeUpdating } from './useHomes'

/*
 * Where a window on an older home would offer what that home refuses it (its
 * agents' sign-ins, its code hosts), what's needed instead, in that place:
 * a line saying the home needs its update for it, and the update itself, run
 * from here where the window can, else its command, or that no release
 * brings it yet.
 */

export const behindText = {
  agents: (home: string) => `Update ${home} to sign its agents in from here.`,
  hosts: (home: string) => `Update ${home} to connect GitHub or GitLab there from here.`,
}

export function HomeBehind({ line }: { line: (home: string) => string }) {
  const { name } = useHomeName()
  const updating = useHomeUpdating(true, undefined, LAST_WITHOUT_SETTING_UP)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const done = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(done)
  }, [copied])
  return (
    <div className={s.behind}>
      <p className={s.behindLine}>{line(name)}</p>
      <UpdateHome
        name={name}
        update={updating.offer}
        onUpdate={updating.onUpdate}
        onCancelUpdate={updating.onCancelUpdate}
        onCheckAgain={updating.onCheckAgain}
        copied={copied}
        onCopy={() => {
          void navigator.clipboard.writeText(updating.offer.command).catch(() => undefined)
          setCopied(true)
        }}
      />
    </div>
  )
}
