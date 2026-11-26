import { useEffect, useState } from 'react'

import { homeWelcomeText, UpdateHome } from '@althar/ui/screens'

import { LAST_WITHOUT_SETTING_UP } from '../../../homes'
import { useHomeName, useHomeUpdating } from './useHomes'

/*
 * Where a window on an older home would offer what that home refuses it (its
 * agents' sign-ins, its code hosts, its own settings), what's needed instead,
 * once, at the head of the section: a strip flat on the section's sheet,
 * saying what the home's update brings, with the update itself, run from here
 * where the window can, else its command; or, where no release brings it yet,
 * that it comes with the next one, quietly, with Check again.
 */

/** What an older home's update brings, by what the section can't do: offered, and where no release brings it yet. */
export interface Behind {
  readonly update: (home: string) => string
  readonly coming: (home: string) => string
}

export const behindText = {
  agents: {
    update: (home: string) => `Update ${home} to sign its agents in from here`,
    coming: (home: string) => `Signing ${home}’s agents in from here comes with its next update`,
  },
  hosts: {
    update: (home: string) => `Update ${home} to connect GitHub or GitLab there from here`,
    coming: (home: string) => `Connecting GitHub or GitLab on ${home} from here comes with its next update`,
  },
  settings: {
    update: (home: string) => `Update ${home} to change these from here`,
    coming: (home: string) => `Changing these from here comes with ${home}’s next update`,
  },
  /** Under the title, where no release brings it yet. */
  unreleased: (home: string) => `No Althar host release has it yet. Once one does, update ${home} here.`,
} satisfies Record<string, Behind | ((home: string) => string)>

export function HomeBehind({ line, since = LAST_WITHOUT_SETTING_UP }: { line: Behind; since?: string }) {
  const { name } = useHomeName()
  const updating = useHomeUpdating(true, undefined, since)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const done = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(done)
  }, [copied])
  const update = homeWelcomeText.update
  return (
    <UpdateHome
      layout="strip"
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
      // Its title says what the update brings, in place of a line over a card of its own.
      text={{
        update: { ...update, title: line.update(name), there: line.update },
        unreleased: { ...homeWelcomeText.unreleased, title: line.coming(name), line: behindText.unreleased },
      }}
    />
  )
}
