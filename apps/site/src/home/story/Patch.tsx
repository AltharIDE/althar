import { type CSSProperties, type ReactNode, useState } from 'react'

import { useDownload } from '../../lib/download'
import s from './Patch.module.css'
import { REVIEW_FACTS, REVIEW_TODAY, REVIEW_TODAY_NOTE, SCENE } from './scenes'

/*
 * The review, drawn as a patch (Story.tsx plays it by the scroll): a file
 * with its line numbers, and the change to it. It opens on today: the
 * preview shows your side of the drawing, the answers carried between two
 * agents by hand, and as each paste lands a line of it comes in beside,
 * red, under "Copy and pasting.", the line taken out, there in full white
 * while it's today's, with a comment of their own. Then the preview pans
 * across to Althar's side, the old line dimming as it goes; the red lines
 * fold away, and "No more.", the line put in, types in, with the lead
 * under it as the change's comment. Then the review's hunks come in, a
 * round at a time, as Althar's side gets to each (`FACT_AT`), every + line
 * typing in and a check drawn beside its header. Each hunk opens and closes
 * by its header: the one just in is open, the rest folded to their
 * headers, and one opened by hand stays so until the next comes in. Under
 * them, once the last has typed in, the download.
 *
 * `at` is where the scroll has the story, in s; Infinity where nothing is
 * typed (motion reduced, or a tablet or a phone, where it isn't pinned): all
 * there, with the first hunk open, and the preview the whole drawing.
 * `enter`, 0 to 1, is how far the section has scrolled up into place: its
 * parts fade and rise in, in turn, as it does (`--in`), and today's comment
 * types in.
 */

/** Today's side of the drawing plays as far as this, in s; the preview pans to Althar's over `PAN`, and Althar's plays from its end (`ALTHAR`). */
const TODAY_S = 12.8
const PAN = [12.8, 14.0] as const
const ALTHAR = PAN[1]
/** Where the story ends, in s: Althar's side at its still moment. */
export const STORY_S = ALTHAR + 10.8
/** Where each side of the drawing stands when the story is at `at`. */
export const sides = (at: number) => ({ today: Math.min(at, TODAY_S), althar: Math.max(0, at - ALTHAR) })

/** When each of today's pastes lands in the drawing, in s, and a line of it comes in. */
const PASTES = [2.15, 5.15, 8.15, 11.15] as const
/** When each hunk comes in, in s of Althar's side: as the reviewer's findings land, as the second round comes back clean, and as the pull request reaches you. */
const FACT_AT = [2.0, 4.9, 8.4] as const
/** As the section comes into place (of `enter`, 0 to 1): the old line counted out, and today's comment typed. */
const OUT = [0.3, 0.45] as const
const TODAY_NOTE = [0.45, 0.9] as const
/** The heading's own beats, in s: the new line typed as the preview pans, and the comment under it. */
const NO_MORE = [PAN[0] + 0.05, PAN[0] + 0.75] as const
const NOTE = [PAN[0] + 0.6, PAN[1] + 0.5] as const
/** When the download comes in under the hunks, in s of Althar's side: as the last hunk has typed in, the pull request in your hands. */
const GET_AT = FACT_AT[2] + 1.6
/** How long each part of a hunk takes to type, in s, from its coming in: its first line, and the rest. */
const HUNK = { title: [0, 0.45], body: [0.45, 1.5] } as const
/** What each hunk's header says. */
const HUNKS = ['round 1 · review by another lab', 'round 2 · fixed until it’s clean', 'pull request · ready for you'] as const
/** What the file says of itself as the review goes, today's by hand first. */
const TODAY = 'today by hand'
const STATUS = ['waiting for review', 'Gemini 3 Pro · 2 findings', 'round 2 · clean', 'checks passed · ready for you'] as const

const LINES = Array.from({ length: 40 }, (_, i) => i + 1)
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const share = (at: number, [from, to]: readonly [number, number]) => clamp((at - from) / (to - from))
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Text typed in as far as `k` (0 to 1): what isn't yet is there unseen, so nothing round it moves as it types; a caret while it does. */
function Typed({ text, k }: { text: string; k: number }) {
  const n = Math.round(text.length * k)
  return (
    <>
      {text.slice(0, n)}
      {n > 0 && n < text.length && <span className={s.caret} aria-hidden="true" />}
      <span className={s.rest}>{text.slice(n)}</span>
    </>
  )
}

export function Patch({ at, enter = 1, preview }: { at: number; enter?: number; preview: ReactNode }) {
  const typing = Number.isFinite(at)
  const today = typing && at < PAN[0]
  const ta = at - ALTHAR
  const arrived = typing ? FACT_AT.filter((t) => ta >= t).length : FACT_AT.length
  const pasted = typing ? PASTES.filter((t) => at >= t).length : 0
  // The hunk just in is open, unless one was opened by hand since; by hand, none open is a choice too.
  const [picked, setPicked] = useState<{ open: number; arrived: number } | null>(null)
  const open = picked && picked.arrived === arrived ? picked.open : typing ? arrived - 1 : 0
  const out = share(enter, OUT)
  const lead = SCENE.review.lead
  const download = useDownload()
  // Its room is held from the start, so nothing moves as it comes in.
  const get = !typing || ta >= GET_AT
  const vars = { '--pan': typing ? smooth(share(at, PAN)).toFixed(4) : 1, '--in': enter.toFixed(4) } as CSSProperties
  return (
    <div className={s.patch} style={vars} data-today={today || undefined}>
      <p className={s.file} aria-hidden="true">
        <b>your-workflow.md</b>
        <span className={s.del}>−{(out > 0.5 ? 1 : 0) + pasted}</span>
        <span className={s.add}>+{(share(at, NO_MORE) > 0 ? 1 : 0) + arrived}</span>
        <span>·</span>
        <span>{today ? TODAY : STATUS[arrived]}</span>
      </p>
      <div className={s.gutter} aria-hidden="true">
        {LINES.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className={s.body}>
        <div className={s.text}>
          <h2 id="review-h" className={s.title}>
            <span className={s.minus}>
              <i aria-hidden="true">−</i>
              <span className={s.old}>Copy and pasting.</span>
            </span>{' '}
            <span className={s.plus}>
              <i aria-hidden="true">+</i>
              <b>
                <Typed text="No more." k={share(at, NO_MORE)} />
              </b>
            </span>
          </h2>
          <p className={s.note}>
            <span aria-hidden="true">// </span>
            <Typed text={lead} k={share(at, NOTE)} />
          </p>
          {typing && (
            <div className={s.byHand} aria-hidden="true">
              <p className={s.note}>
                <span>// </span>
                <Typed text={REVIEW_TODAY_NOTE} k={share(enter, TODAY_NOTE)} />
              </p>
              <ol>
                {REVIEW_TODAY.map((line, i) => {
                  const k = share(at, [PASTES[i]!, PASTES[i]! + 0.55])
                  return (
                    <li key={line} className={s.row} data-in={k > 0 || undefined}>
                      <i>−</i>
                      <p>
                        <Typed text={line} k={k} />
                      </p>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
          <ol className={s.hunks}>
            {REVIEW_FACTS.map((fact, i) => {
              const since = ta - FACT_AT[i]!
              const on = open === i
              const id = `review-hunk-${i}`
              return (
                <li key={fact.title} className={s.hunk} data-in={i < arrived || undefined} data-open={on || undefined}>
                  <h3 className={s.hh}>
                    <button
                      type="button"
                      aria-expanded={on}
                      aria-controls={id}
                      tabIndex={i < arrived ? undefined : -1}
                      onClick={() => setPicked({ open: on ? -1 : i, arrived })}
                    >
                      <svg className={s.check} viewBox="0 0 18 18" aria-hidden="true">
                        <circle cx="9" cy="9" r="7.8" pathLength={1} />
                        <path d="M5.6 9.3l2.4 2.4 4.5-4.8" pathLength={1} />
                      </svg>
                      <span className={s.at}>{HUNKS[i]}</span>
                      <svg className={s.chevron} viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </button>
                  </h3>
                  <div id={id} className={s.more} inert={!on || undefined}>
                    <div>
                      <div className={s.row}>
                        <i aria-hidden="true">+</i>
                        <p>
                          <b>
                            <Typed text={fact.title} k={share(since, HUNK.title)} />
                          </b>
                        </p>
                      </div>
                      <div className={s.row}>
                        <i aria-hidden="true">+</i>
                        <p>
                          <Typed text={fact.body} k={share(since, HUNK.body)} />
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          <a className={s.get} href={download.href} data-in={get || undefined} tabIndex={get ? undefined : -1}>
            {download.pending ? 'Download' : download.label}
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />
            </svg>
          </a>
        </div>
        <div className={s.preview}>
          <div className={s.crop}>{preview}</div>
        </div>
      </div>
    </div>
  )
}
