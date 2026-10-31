import { Checkbox } from 'radix-ui'
import { type ReactNode, useId, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import type { Disclosable } from '../../primitives/Fold/Fold'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import type { GalleryShot } from '../../thread/Gallery/Gallery'
import { ImageView, type ImageViewText } from '../../thread/Lightbox/Lightbox'
import s from './PostScreenshots.module.css'

/*
 * A task's screenshots, as they are now, in one comment on its pull request:
 * a quiet line at the end of What it looks like's heading that says where
 * they stand there, and opens a sheet of them, each ticked to go or left out,
 * with the press that posts them or brings the comment up to date. What is
 * left out is the consumer's to keep, per pull request; the sheet only
 * drafts it until it is posted.
 */

/** Where the pull request's comment stands against the screenshots shown. */
export type PostScreenshotsStanding = 'unposted' | 'posted' | 'changed' | 'synced'

export type PostScreenshotsShot = GalleryShot & {
  /** The view's own key, which stays the same as its picture is taken again. */
  readonly key: string
}

export interface PostScreenshotsText {
  /** The line, before any are posted. */
  post: (pullRequest: string) => string
  /** The line, posted and nothing changed since. */
  posted: (pullRequest: string) => string
  /** The line, with screenshots that differ from what the pull request shows. */
  update: (pullRequest: string, changed: number | undefined) => string
  /** The line, while the project keeps it up to date itself. */
  synced: (pullRequest: string) => string
  /** The line, with some left out of this pull request. */
  withLeftOut: (line: string, leftOut: number) => string
  /** The sheet's name. */
  sheet: (pullRequest: string) => string
  /** What goes where. `count` is the number, set to keep its width. */
  goes: (count: ReactNode, n: number, destination: string) => ReactNode
  /** A screenshot's toggle. */
  include: (caption: string) => string
  /** The press, before any are posted. */
  confirmPost: (n: number, pullRequest: string) => string
  /** The press, once they are. */
  confirmUpdate: (pullRequest: string) => string
  /** Pressed with every screenshot left out. */
  none: string
  /** The comment, where it can be opened. */
  open: (host: string | undefined) => string
  newTab: string
  image: Partial<ImageViewText>
}

export const postScreenshotsText: PostScreenshotsText = {
  post: (pr) => `Post to ${pr}`,
  posted: (pr) => `Posted to ${pr}`,
  update: (pr, changed) => (changed ? `Update ${pr} · ${changed} changed` : `Update ${pr}`),
  synced: (pr) => `Synced to ${pr}`,
  withLeftOut: (line, n) => `${line} · ${n} left out`,
  sheet: (pr) => `Screenshots on ${pr}`,
  goes: (count, n, destination) => (
    <>
      {count} {n === 1 ? 'screenshot' : 'screenshots'} → {destination}
    </>
  ),
  include: (caption) => `Include ${caption}`,
  confirmPost: (n, pr) => `Post ${n} to ${pr}`,
  confirmUpdate: (pr) => `Update ${pr}`,
  none: 'Choose at least one screenshot.',
  open: (host) => (host ? `Open on ${host}` : 'Open the comment'),
  newTab: '(opens in a new tab)',
  image: {},
}

export type PostScreenshotsProps = RootProps<
  'button',
  Disclosable & {
    standing: PostScreenshotsStanding
    /** The pull request, formatted: PR #142, MR !12. */
    pullRequest: string
    /** What Outputs shows under What it looks like, in its order. */
    shots: ReadonlyArray<PostScreenshotsShot>
    /** The keys left out of this pull request. */
    leftOut: ReadonlyArray<string>
    /** With `changed`: how many screenshots differ from what the pull request shows. */
    changed?: number
    /** Where they go, formatted: a comment on acme/web #142. */
    destination: string
    /** Post them, or bring the comment up to date, with these keys left out (those among `shots`, in their order). Without it, no press. */
    onPost?: (leftOut: ReadonlyArray<string>) => void
    /** The comment on the host, once posted. */
    commentUrl?: string
    /** The host, for the link's words: GitHub. */
    host?: string
    /** Posting is under way. */
    posting?: boolean
    /** Why the last post didn't go. */
    error?: ReactNode
    text?: Partial<PostScreenshotsText>
  }
>

const STANDINGS: ReadonlyArray<PostScreenshotsStanding> = ['unposted', 'posted', 'changed', 'synced']

export function PostScreenshots({
  standing,
  pullRequest,
  shots,
  leftOut,
  changed,
  destination,
  onPost,
  commentUrl,
  host,
  posting = false,
  error,
  open,
  defaultOpen = false,
  onOpenChange,
  text,
  className,
  ...rest
}: PostScreenshotsProps) {
  const t = { ...postScreenshotsText, ...text, image: { ...postScreenshotsText.image, ...text?.image } }
  const [isOpen, setOpen] = useControlled(open, defaultOpen, onOpenChange)
  const missingId = useId()

  /* what the sheet drafts: the given ones left out, again each time it opens or they change */
  const given = leftOut.join('\n')
  const [draft, setDraft] = useState<ReadonlySet<string>>(() => new Set(leftOut))
  const [missing, setMissing] = useState(false)
  const [basis, setBasis] = useState({ isOpen, given })
  if (basis.isOpen !== isOpen || basis.given !== given) {
    setBasis({ isOpen, given })
    if (isOpen) {
      setDraft(new Set(leftOut))
      setMissing(false)
    }
  }

  const keys = new Set(shots.map((shot) => shot.key))
  const outNow = leftOut.filter((key) => keys.has(key)).length
  const going = shots.filter((shot) => !draft.has(shot.key)).length

  const lineOf = (one: PostScreenshotsStanding) => {
    const line = wordsOf(one, pullRequest, changed, t)
    return outNow > 0 ? t.withLeftOut(line, outNow) : line
  }

  const toggle = (key: string, on: boolean) => {
    const next = new Set(draft)
    if (on) next.delete(key)
    else next.add(key)
    setDraft(next)
    if (on) setMissing(false)
  }

  const confirm = () => {
    if (!onPost) return
    if (going === 0) {
      setMissing(true)
      return
    }
    setMissing(false)
    onPost(shots.filter((shot) => draft.has(shot.key)).map((shot) => shot.key))
  }

  const href = safeHref(commentUrl)

  return (
    <Popover
      label={t.sheet(pullRequest)}
      placement="below"
      align="end"
      width={380}
      initialFocus="panel"
      open={isOpen}
      onOpenChange={setOpen}
      trigger={
        <LinkButton className={cx(s.trigger, className)} {...rest}>
          {/* every standing's words in one cell, the others unseen, so the heading keeps its width as it changes */}
          <span className={s.lines}>
            {STANDINGS.map((one) => (
              <span key={one} className={cx(s.line, one !== standing && s.unseen)} aria-hidden={one !== standing || undefined}>
                {one === 'posted' && <Icon name="check" size={11} className={s.tick} />}
                {lineOf(one)}
              </span>
            ))}
          </span>
        </LinkButton>
      }
    >
      <div className={s.sheet}>
        <p className={s.goes}>
          {t.goes(
            <span className={s.n} style={{ minWidth: `${String(shots.length).length}ch` }}>
              {going}
            </span>,
            going,
            destination,
          )}
        </p>
        <div className={s.grid}>
          {shots.map((shot) => {
            const on = !draft.has(shot.key)
            return (
              <Tooltip key={shot.key} label={shot.caption} placement="above">
                <Checkbox.Root
                  checked={on}
                  onCheckedChange={(next) => toggle(shot.key, next === true)}
                  aria-label={t.include(shot.caption)}
                  className={s.thumb}
                >
                  <span
                    className={s.frame}
                    style={
                      shot.width !== undefined && shot.height !== undefined
                        ? { aspectRatio: `${shot.width} / ${shot.height}` }
                        : undefined
                    }
                  >
                    <ImageView image={shot} size="thumb" fit="cover" text={t.image} />
                  </span>
                  <span className={s.box} aria-hidden="true">
                    <Checkbox.Indicator className={s.mark}>
                      <Icon name="check" size={9} />
                    </Checkbox.Indicator>
                  </span>
                </Checkbox.Root>
              </Tooltip>
            )
          })}
        </div>
        {error !== undefined && error !== null && error !== false && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {(onPost || href) && (
          <div className={s.foot}>
            {href && (
              <a className={s.open} href={href} target="_blank" rel="noreferrer">
                {t.open(host)}
                <VisuallyHidden> {t.newTab}</VisuallyHidden>
              </a>
            )}
            {onPost && (
              <span className={s.end}>
                {missing && (
                  <span id={missingId} className={s.missing} role="alert">
                    {t.none}
                  </span>
                )}
                <Button size="small" busy={posting} aria-describedby={missing ? missingId : undefined} onClick={confirm}>
                  {standing === 'unposted' ? t.confirmPost(going, pullRequest) : t.confirmUpdate(pullRequest)}
                </Button>
              </span>
            )}
          </div>
        )}
      </div>
    </Popover>
  )
}

function wordsOf(standing: PostScreenshotsStanding, pullRequest: string, changed: number | undefined, t: PostScreenshotsText) {
  switch (standing) {
    case 'unposted':
      return t.post(pullRequest)
    case 'posted':
      return t.posted(pullRequest)
    case 'changed':
      return t.update(pullRequest, changed)
    case 'synced':
      return t.synced(pullRequest)
    default:
      return unreachable(standing)
  }
}
