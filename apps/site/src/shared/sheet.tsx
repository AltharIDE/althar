import { STAGE_WORD } from '../content/facts'
import { STORY } from '../content/meridian'
import { DEFINITION, REVISIONS } from '../content/sheet'
import { cx } from '../lib/cx'
import s from './sheet.module.css'

/*
 * The pieces a drawing set would carry, used on both pages: task 418's steps
 * keyed to its graph, the roadmap as a revision block, the stamp, and the
 * word itself. Each is coloured by the page's --sh-* variables and lays
 * itself out by the width it's given.
 */

function KeyNo({ n }: { n: number }) {
  return <span className={s.keyNo}>{n}</span>
}

/** Task 418's steps, keyed 1 to 8 to match its graph. */
export function StoryKeys({ className }: { className?: string }) {
  return (
    <div className={cx(s.fit, className)}>
      <ol className={s.keys}>
        {STORY.map((st, i) => (
          <li key={st.id} className={cx(st.you && s.keyYou)}>
            <KeyNo n={i + 1} />
            <div>
              <b>
                {st.name} <span>· {st.who}</span>
              </b>
              <p>{st.what}</p>
            </div>
          </li>
        ))}
        <li>
          <KeyNo n={8} />
          <div>
            <b>
              Note <span>· kept by the project</span>
            </b>
            <p>Your answer becomes a note. Every task after this one starts with it, whichever agent runs it.</p>
          </div>
        </li>
      </ol>
    </div>
  )
}

/** Where it stands, as a revision block. */
export function Revisions({ className, caption = 'Revisions' }: { className?: string; caption?: string }) {
  return (
    <div className={cx(s.fit, className)}>
      <table className={s.revs}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Rev</th>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {REVISIONS.map((r) => (
            <tr key={r.rev} className={s[r.stage]}>
              <td className={s.mark}>{r.rev}</td>
              <td className={s.mark}>{r.date}</td>
              <td>{r.what}</td>
              <td className={s.stage}>{STAGE_WORD[r.stage]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Stamp({
  lines = ['Preliminary', 'Issued for comment', 'Not for construction'],
  className,
}: {
  lines?: readonly [string, string, string]
  className?: string
}) {
  const [top, main, foot] = lines
  return (
    <p className={cx(s.stamp, className)} aria-label={`${top}. ${main}. ${foot}.`}>
      <span>{top}</span>
      <b>{main}</b>
      <span>{foot}</span>
    </p>
  )
}

export function Define({ className }: { className?: string }) {
  return (
    <dl className={cx(s.define, className)}>
      <dt>
        {DEFINITION.word} <i>{DEFINITION.say}</i> <em>{DEFINITION.kind}</em>
      </dt>
      <dd>{DEFINITION.sense}</dd>
    </dl>
  )
}
