import { Icon, LinkButton, Menu, MenuRadioGroup, MenuRadioItem, Model } from '@althar/ui'
import { type ReactNode, useContext, useEffect, useState } from 'react'

import { BrandMark } from '../../src/foundations/Marks/Marks'
import { Acts, canGoFull, type Direction, Explained, ReviewMode, Where } from './calm'
import c from './calm.module.css'
import r from './review.module.css'
import { type SmallState, SOL } from './states'

/*
 * Fourth round: B's one line, with the review after merge something this one
 * change can drop, or take back when the project's setting has none. Each
 * keeps its own choice, so the page can be clicked through; the project's
 * setting (R) is where each starts.
 */

export type Review = 'before' | 'after' | 'none'

/** This change's review, starting from the project's setting; Before makes it a full task. */
export function useReview(s: SmallState) {
  const project = useContext(ReviewMode)
  const [review, setReview] = useState<Review>(project === 'off' ? 'none' : 'after')
  useEffect(() => setReview(project === 'off' ? 'none' : 'after'), [project])
  const shown: SmallState = review === 'before' && canGoFull(s) ? { ...s, key: 'full' } : s
  const mode: ReviewMode = review === 'none' ? 'off' : project === 'off' ? 'major' : project
  const open = canGoFull(shown)
  return { review, setReview, shown, mode, open }
}

function Line({ s, children }: { s: SmallState; children?: ReactNode }) {
  return (
    <div className={c.line}>
      <Icon name="after" size={12} />
      <Explained s={s}>
        <span className={c.kind}>{s.key === 'full' ? 'Full task' : 'Small change'}</span>
      </Explained>
      <span className={c.lineTitle}>{s.title}</span>
      {children}
      <Where s={s} />
      <Acts s={s} />
    </div>
  )
}

export const WORDS: Record<Review, string> = { before: 'Review first', after: 'Review after merge', none: 'No review' }

/** The three choices, as a menu; Before is what Make it a full task was. */
export function Choices({ review, onChange, project }: { review: Review; onChange: (v: Review) => void; project: ReviewMode }) {
  return (
    <MenuRadioGroup label="Review" value={review} onChange={(v) => onChange(v as Review)}>
      <MenuRadioItem value="before" description="Makes it a full task">
        Before it merges
      </MenuRadioItem>
      <MenuRadioItem value="after" description={project === 'all' ? 'Anything it finds comes back' : 'Only something major comes back'}>
        After it merges
      </MenuRadioItem>
      <MenuRadioItem value="none">No review</MenuRadioItem>
    </MenuRadioGroup>
  )
}

/* ——— D · A menu, there while you point ——— */

function Pointed({ state }: { state: SmallState }) {
  const project = useContext(ReviewMode)
  const { review, setReview, shown, mode, open } = useReview(state)
  return (
    <ReviewMode.Provider value={mode}>
      <Line s={shown}>
        {open && (
          <Menu
            label="Review"
            width={240}
            align="end"
            trigger={
              <button type="button" className={r.pointed}>
                {WORDS[review]}
                <Icon name="chevronD" size={10} />
              </button>
            }
          >
            <Choices review={review} onChange={setReview} project={project} />
          </Menu>
        )}
      </Line>
    </ReviewMode.Provider>
  )
}

/* ——— E · Two quiet links, there while you point ——— */

function Links({ state }: { state: SmallState }) {
  const { review, setReview, shown, mode, open } = useReview(state)
  return (
    <ReviewMode.Provider value={mode}>
      <Line s={shown}>
        {open && (
          <span className={r.links}>
            <LinkButton className={r.link} onClick={() => setReview(review === 'none' ? 'after' : 'none')}>
              {review === 'none' ? 'Review after merge' : 'Skip the review'}
            </LinkButton>
            <LinkButton className={r.link} onClick={() => setReview('before')}>
              Make it a full task
            </LinkButton>
          </span>
        )}
      </Line>
    </ReviewMode.Provider>
  )
}

/* ——— F · The reviewer's mark, always there ——— */

function Mark({ state }: { state: SmallState }) {
  const project = useContext(ReviewMode)
  const { review, setReview, shown, mode, open } = useReview(state)
  const mark = (
    <span className={r.mark} data-off={review === 'none' || undefined}>
      <BrandMark brand={SOL.mark!} size={13} />
    </span>
  )
  return (
    <ReviewMode.Provider value={mode}>
      <Line s={shown}>
        {review !== 'before' &&
          (open ? (
            <Menu
              label="Review"
              width={240}
              align="end"
              note={
                <>
                  <Model model={SOL} short /> reviews it
                </>
              }
              trigger={
                <button type="button" className={r.markButton} aria-label={WORDS[review]}>
                  {mark}
                </button>
              }
            >
              <Choices review={review} onChange={setReview} project={project} />
            </Menu>
          ) : (
            mode !== 'off' && mark
          ))}
      </Line>
    </ReviewMode.Provider>
  )
}

export const REVIEWS: readonly Direction[] = [
  {
    key: 'd',
    letter: 'D',
    name: 'One line, a review menu',
    idea: 'Point at the line: “Review after merge ▾” opens Before it merges, After it merges, No review. It takes Make it a full task’s place.',
    Card: Pointed,
  },
  {
    key: 'e',
    letter: 'E',
    name: 'One line, two links',
    idea: 'Point at the line: Skip the review (or Review after merge, where it has none) and Make it a full task.',
    Card: Links,
  },
  {
    key: 'f',
    letter: 'F',
    name: 'One line, the reviewer’s mark',
    idea: 'The reviewer’s mark sits on the line while a review is coming, struck through when there is none; it opens the same menu as D.',
    Card: Mark,
  },
]
