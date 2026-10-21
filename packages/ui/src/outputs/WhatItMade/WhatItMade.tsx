import { useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Checked, type CheckedText } from '../../thread/Checked/Checked'
import type { EvidencePiece } from '../../thread/Evidence/Evidence'
import type { GalleryShot } from '../../thread/Gallery/Gallery'
import { ImageView } from '../../thread/Lightbox/Lightbox'
import { Markdown } from '../../thread/Markdown/Markdown'
import { useThreadShell } from '../../thread/Shell/Shell'
import s from './WhatItMade.module.css'

/*
 * What a task came to, read before deciding on it: what it is, its first
 * paragraph large and the rest a press away; how it looks now, its pictures
 * large, two across, each opening full size with the others a key away, the
 * first few of many with the rest a press away too; then
 * what its lead couldn't check, which is still the person's, before what it
 * did. Each part only where there is something to say.
 */

export interface WhatItMadeText {
  /** Over what it is: a change, or what another task made. */
  story: string
  looks: string
  more: string
  less: string
  /** Under the first few of many pictures, to show them all, and back. */
  all: (count: number) => string
  fewer: string
  view: (caption: string) => string
  checked: Partial<CheckedText>
}

export const whatItMadeText: WhatItMadeText = {
  story: 'What changed',
  looks: 'What it looks like',
  more: 'Read all of it',
  less: 'Show less',
  all: (count) => `Show all ${count}`,
  fewer: 'Show fewer',
  view: (caption) => `View ${caption} full size`,
  checked: {},
}

export type WhatItMadeProps = RootProps<
  'div',
  {
    /** What it is, in markdown: the part that says so, and the rest. */
    story: { readonly lede: string; readonly rest: string } | null
    /** Its pictures as it is now. */
    shots: ReadonlyArray<GalleryShot>
    /** What its lead showed of it working, other than pictures. */
    checked: ReadonlyArray<EvidencePiece>
    /** What it couldn't show working. */
    unverified: ReadonlyArray<string>
    headingLevel?: HeadingLevel
    text?: Partial<WhatItMadeText>
  }
>

/** Past this many pictures, the first few show, the rest a press away: at least three are. */
const MANY = 8
const FEW = 6

export function WhatItMade({ story, shots, checked, unverified, headingLevel = 2, text, className, ...rest }: WhatItMadeProps) {
  const t = { ...whatItMadeText, ...text }
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const { openImage } = useThreadShell()
  const many = shots.length > MANY
  return (
    <div className={cx(s.made, className)} {...rest}>
      {story !== null && (
        <section className={s.part}>
          <Heading level={headingLevel} className={s.label}>
            {t.story}
          </Heading>
          <div className={s.story}>
            <Markdown source={story.lede} className={s.lede} />
            {story.rest !== '' && (
              <>
                {open && <Markdown source={story.rest} headingLevel={headingLevel === 6 ? 6 : ((headingLevel + 1) as HeadingLevel)} />}
                <LinkButton className={s.more} aria-expanded={open} onClick={() => setOpen(!open)}>
                  {open ? t.less : t.more}
                </LinkButton>
              </>
            )}
          </div>
        </section>
      )}
      {shots.length > 0 && (
        <section className={s.part}>
          <Heading level={headingLevel} className={s.label}>
            {t.looks}
            <span className={s.count}>{shots.length}</span>
          </Heading>
          <div className={cx(s.shots, shots.length === 1 && s.one)}>
            {(many && !all ? shots.slice(0, FEW) : shots).map((shot) => {
              const frame = (
                <span
                  className={s.frame}
                  style={
                    shot.width !== undefined && shot.height !== undefined ? { aspectRatio: `${shot.width} / ${shot.height}` } : undefined
                  }
                >
                  <ImageView image={shot} size="thumb" />
                </span>
              )
              return (
                <figure key={shot.id} className={s.shot}>
                  {/* One that wasn't kept says why where it would be, and opens to nothing. */}
                  {openImage && shot.status !== 'failed' ? (
                    <button type="button" className={s.image} onClick={() => openImage(shot, shots)} aria-label={t.view(shot.caption)}>
                      {frame}
                    </button>
                  ) : (
                    <span className={s.image}>{frame}</span>
                  )}
                  <figcaption className={s.caption}>{shot.caption}</figcaption>
                </figure>
              )
            })}
          </div>
          {many && (
            <LinkButton className={s.more} aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? t.fewer : t.all(shots.length)}
            </LinkButton>
          )}
        </section>
      )}
      {/* What it couldn't check is still the person's: it comes first. */}
      <Checked pieces={[]} unverified={unverified} text={t.checked} />
      <Checked pieces={checked} text={t.checked} />
    </div>
  )
}
