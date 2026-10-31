import { useMemo } from 'react'

import { cx } from '../../lib/cx'
import { useTheme } from '../../lib/theme'
import { Choices } from '../../primitives/Choices/Choices'
import { SEAL_STYLES, type SealFacts, type SealInk, type SealStyle, sealLine, sealSvg } from '../../seal/seal'
import s from './ReviewSeal.module.css'

/*
 * Whether a pull request Althar opens says how its change was reviewed,
 * shown as the code host shows one, as Althar as co-author shows a commit:
 * the start of its description with the seal in its corner, and the review
 * folded under it. On, the seal's three looks to pick from, under it.
 * Turned off, the seal's place is only its outline, the review's line is
 * struck through, and under it what goes out instead. The switch is the
 * consumer's, in the head of what holds this.
 */

export interface ReviewSealText {
  /** The pull request, for a screen reader. */
  pullRequest: string
  /** What the seal's looks are chosen with. */
  look: string
  styles: Record<SealStyle, string>
  /** What goes out while it is off. */
  alone: string
}

export const reviewSealText: ReviewSealText = {
  pullRequest: 'A pull request as GitHub shows it',
  look: 'Seal',
  styles: { ring: 'Ring', wax: 'Wax', colophon: 'Colophon' },
  alone: 'Pull requests go out with only their description.',
}

/** A pull request to show the seal on, as the code host would. */
export interface ReviewSealSample {
  title: string
  /** As the host numbers it: #212. */
  number: string
  /** The start of its description, a sentence or two. */
  text: string
  facts: SealFacts
}

export interface ReviewSealProps {
  on: boolean
  style: SealStyle
  onStyle: (style: SealStyle) => void
  sample: ReviewSealSample
  text?: Partial<ReviewSealText>
  className?: string
}

/** A seal as a picture's address, in the ink for the theme showing. */
const picture = (style: SealStyle, facts: SealFacts, ink: SealInk) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sealSvg(style, facts, ink))}`

/** The review on a pull request, as the code host shows it; on, its seal's look to pick. */
export function ReviewSeal({ on, style, onStyle, sample, text, className }: ReviewSealProps) {
  const t = { ...reviewSealText, ...text }
  const ink = useTheme()
  const seals = useMemo(
    () => Object.fromEntries(SEAL_STYLES.map((one) => [one, picture(one, sample.facts, ink)])) as Record<SealStyle, string>,
    [sample.facts, ink],
  )
  const said = sealLine(sample.facts)
  return (
    <div className={cx(s.reviewSeal, className)}>
      <figure className={cx(s.pullRequest, !on && s.off)} aria-label={t.pullRequest}>
        <div className={s.head}>
          <span className={s.title}>{sample.title}</span> <span className={s.number}>{sample.number}</span>
        </div>
        <div className={s.body}>
          {on ? <img className={s.seal} src={seals[style]} alt={said} /> : <span className={cx(s.seal, s.ghost)} aria-hidden="true" />}
          <p className={s.text}>{sample.text}</p>
          <p className={s.folded}>
            <span className={s.caret} aria-hidden="true" />
            {said.slice(0, -sample.facts.sha.slice(0, 7).length)}
            <code>{sample.facts.sha.slice(0, 7)}</code>
          </p>
        </div>
      </figure>
      {on ? (
        <Choices
          label={t.look}
          layout="tiles"
          options={SEAL_STYLES.map((one) => ({
            value: one,
            title: t.styles[one],
            picture: <img className={s.pick} src={seals[one]} alt="" />,
          }))}
          value={style}
          onChange={onStyle}
        />
      ) : (
        <p className={s.after}>{t.alone}</p>
      )}
    </div>
  )
}

/** The seal small and round, as a setting's glyph beside its name. */
export function ReviewSealGlyph({ facts, size = 30, className }: { facts: SealFacts; size?: number; className?: string }) {
  const ink = useTheme()
  const src = useMemo(() => picture('ring', facts, ink), [facts, ink])
  return <img className={cx(s.glyph, className)} src={src} width={size} height={size} alt="" />
}
