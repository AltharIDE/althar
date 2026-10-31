import type { ChangeSummary } from '@althar/contracts'
import { type GalleryShot, PostScreenshots } from '@althar/ui'
import { useState } from 'react'

import { productName } from '../../shared/products'

/*
 * The task's screenshots on its pull request (ADR-076), beside What it looks
 * like: a quiet line saying where they stand there, which opens the
 * screenshots Outputs shows, each to leave out or keep, and the button that
 * posts them, or writes the comment anew. Where the project's rules post
 * them on their own it says so, and still opens, to leave one out. Only for
 * a pull request whose host takes pictures (`screenshots` on it): in a task
 * of several repositories, the first.
 */

export const text = {
  /** A pull request by name, as the line and the button say it: PR #142. */
  named: (change: ChangeSummary) => `${change.short} ${change.prefix}${change.number}`,
  /** Where the screenshots go, in the sheet: a comment on meridian/api #142. */
  destination: (change: ChangeSummary) => `a comment on ${change.repository} ${change.prefix}${change.number}`,
}

/** The pull request whose comment shows the screenshots: the first open one whose host takes pictures. */
export const screenshotsTarget = (changes: ReadonlyArray<ChangeSummary>) =>
  changes.find((change) => change.state === 'open' && change.screenshots !== undefined)

export function ScreenshotsOnPullRequest({
  change,
  shots,
  onPost,
}: {
  change: ChangeSummary
  /** What Outputs shows under What it looks like, each with its view's key. */
  shots: ReadonlyArray<GalleryShot & { readonly key: string }>
  /** Posts them without the views left out: null once they're up, else what went wrong. */
  onPost: (url: string, leftOut: ReadonlyArray<string>) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [posting, setPosting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const { screenshots } = change
  if (screenshots === undefined) return null
  // What went wrong pressing it, else why the last try failed, as the runtime kept it.
  const error = failed ?? screenshots.failed
  return (
    <PostScreenshots
      standing={screenshots.synced ? 'synced' : screenshots.standing}
      pullRequest={text.named(change)}
      shots={shots}
      leftOut={screenshots.leftOut}
      changed={screenshots.changed}
      destination={text.destination(change)}
      host={productName(change.product)}
      {...(screenshots.commentUrl === null ? {} : { commentUrl: screenshots.commentUrl })}
      posting={posting}
      {...(error === null ? {} : { error })}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setFailed(null)
      }}
      onPost={(leftOut) => {
        setPosting(true)
        setFailed(null)
        void onPost(change.url, leftOut).then((said) => {
          setPosting(false)
          setFailed(said)
          // Up: the sheet closes, and the line says it is.
          if (said === null) setOpen(false)
        })
      }}
    />
  )
}
