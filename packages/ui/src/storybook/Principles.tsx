import { useState, type ReactNode } from 'react'

import { CallCard } from '../board/CallCard/CallCard'
import { WorkCard } from '../board/WorkCard/WorkCard'
import { WorkStatus } from '../chrome/WorkStatus/WorkStatus'
import { Composer } from '../composer/Composer/Composer'
import { ContextRing } from '../composer/ContextRing/ContextRing'
import { Issue } from '../coordinator/Issue/Issue'
import { PriorityGlyph, StatusGlyph } from '../coordinator/Issue/glyphs'
import { CALLS, RUNNING } from '../fixtures/board'
import { MER_231 } from '../fixtures/coordinator'
import { model } from '../fixtures/models'
import { Brand } from '../foundations/brands/brands'
import { IssuePriority, IssueStatus, TaskStatus } from '../foundations/vocabulary'
import { Delta } from '../primitives/FileChanges/FileChanges'
import { TaskGlyph } from '../primitives/TaskGlyph/TaskGlyph'
import s from './Principles.module.css'

/*
 * The Charrette team's design principles, written for anyone outside the
 * team: what we believe, what you would notice because of it, and a real
 * component where you can see it. Every specimen is the component itself.
 */

const noop = () => {}
const href = (story: string) => `./?path=/story/${story}`

interface Principle {
  id: string
  title: string
  belief: string
  notice: { lead: string; body: string }[]
  specimen: ReactNode
  caption: string
  story: string
}

const PRINCIPLES: Principle[] = [
  {
    id: 'calm',
    title: 'Calm',
    belief:
      'Most of the time, the work doesn’t need you. A tool that runs work on your behalf should be quiet while nothing is wrong, and unmistakable when something is.',
    notice: [
      {
        lead: 'Colour is a signal, not decoration.',
        body: 'Blue means something is moving. Violet means something is waiting on you. Green is something added or merged, red something removed or broken. Everything else is ink on paper, so when colour appears, it means something.',
      },
      {
        lead: 'Violet is kept for real decisions.',
        body: 'If nothing stops until you answer, it isn’t violet. A violet dot never cries wolf.',
      },
      {
        lead: 'Only live work moves.',
        body: 'A pulse means an agent is working right now. Nothing blinks to get your attention.',
      },
      {
        lead: 'We say what’s true, and stop.',
        body: '“Nothing here needs you” is the whole message. No confetti, no pitch.',
      },
    ],
    specimen: <Colours />,
    caption: 'The five inks, each where Charrette uses it, and the window’s status line reading the same way.',
    story: 'chrome-workstatus--all-states',
  },
  {
    id: 'clean',
    title: 'Clean',
    belief:
      'Every mark on the screen has to earn its place. If it doesn’t tell you where your work stands or what you can do about it, we take it out.',
    notice: [
      {
        lead: 'Words, not ornament.',
        body: 'No coloured stripes down the side of cards, no pastel badges, no glowing shadows. What kind of thing you are looking at is said in a word.',
      },
      {
        lead: 'Enough to decide, and no more.',
        body: 'A card on the board shows what you need to decide whether to open it: what it is, where it stands, and who is on it.',
      },
      {
        lead: 'Space does the organising.',
        body: 'Alignment and rhythm group things, not boxes inside boxes.',
      },
    ],
    specimen: (
      <div className={s.cards}>
        <CallCard {...CALLS[0]!} onOpen={noop} />
        <WorkCard {...RUNNING[0]!} onOpen={noop} />
      </div>
    ),
    caption: 'A decision waiting on you, and a task at work, from the board. A word says what each one is; the rest says where it stands.',
    story: 'board-board--default',
  },
  {
    id: 'intuitive',
    title: 'Obsessively intuitive',
    belief:
      'You shouldn’t have to learn Charrette. We keep at it until the obvious guess is the right one: the button you reach for does what you meant, and the key you would try first works.',
    notice: [
      {
        lead: 'Controls follow the moment, not a mode.',
        body: 'The composer has one button. With nothing written, it shows the key that brings you back to it; with something written, it sends. While the agent works, it offers to interrupt it; what you write waits until the agent is done, unless you send it now.',
      },
      {
        lead: 'Escape always takes you back one step.',
        body: 'Out of the note you are writing, then the panel it is in, then the task. Never further than you meant.',
      },
      {
        lead: 'Shortcuts sit beside what they do.',
        body: 'You learn them by looking, not from a help page.',
      },
      {
        lead: 'Learn a thing once.',
        body: 'A task’s progress, a model’s mark, a status: each looks the same everywhere it appears.',
      },
    ],
    specimen: <Moments />,
    caption: 'The composer’s one button, in four moments. Type in any of them and watch it change.',
    story: 'composer-composer--all-states',
  },
  {
    id: 'small',
    title: 'Sweating the small stuff',
    belief:
      'Most of what makes a tool feel right is in details nobody asks for. We design every state, not only the one in the screenshot: hover, focus, loading, empty, too long, and at the edge of the window.',
    notice: [
      {
        lead: 'Other tools look like themselves.',
        body: 'Paste a Linear link and it unfolds into Linear’s card, its status and priority drawn the way Linear draws them. The only place Linear’s colour appears in Charrette is on Linear’s card.',
      },
      {
        lead: 'Decoration holds still.',
        body: 'The field of squares behind that card only moves while you point at it. Even then it runs at a low frame rate, pauses off screen, and never moves if you have asked your system for less motion.',
      },
      {
        lead: 'Numbers hold still.',
        body: 'Counts and timers use figures of one width, so nothing jitters as they tick.',
      },
      {
        lead: 'For everyone.',
        body: 'We build to WCAG 2.2 AA. Everything works from the keyboard, quiet text is still readable text, and a screen reader hears what you see.',
      },
    ],
    specimen: <Trackers />,
    caption: 'A Linear issue pasted into a conversation, the same card for Jira in ink, and the workflow glyphs as drawn.',
    story: 'coordinator-issue--linear',
  },
]

export function PrinciplesHero() {
  return (
    <header className={s.hero}>
      <h1 className={s.title}>Principles</h1>
      <p className={s.lede}>
        Charrette is where agents do the work while you do yours. These are the four ideas the Charrette team designs by, and the details
        where you can see each one.
      </p>
      <nav aria-label="Principles" className={s.index}>
        {PRINCIPLES.map((p, i) => (
          <a key={p.id} href={`#${p.id}`} className={s.indexItem}>
            <span className={s.number}>{String(i + 1).padStart(2, '0')}</span>
            {p.title}
          </a>
        ))}
      </nav>
    </header>
  )
}

export function PrinciplesList() {
  return (
    <div className={s.list}>
      {PRINCIPLES.map((p, i) => (
        <section key={p.id} id={p.id} className={s.principle} aria-labelledby={`${p.id}-title`}>
          <div className={s.head}>
            <span className={s.number}>{String(i + 1).padStart(2, '0')}</span>
            <h2 id={`${p.id}-title`} className={s.name}>
              {p.title}
            </h2>
            <p className={s.belief}>{p.belief}</p>
          </div>
          <ul className={s.notice}>
            {p.notice.map((r) => (
              <li key={r.lead} className={s.point}>
                <b>{r.lead}</b> {r.body}
              </li>
            ))}
          </ul>
          <figure className={s.specimen}>
            <div className={s.stage}>{p.specimen}</div>
            <figcaption className={s.caption}>
              <span>{p.caption}</span>
              <a className={s.see} href={href(p.story)} target="_top">
                See it in the kit
              </a>
            </figcaption>
          </figure>
        </section>
      ))}
      <p className={s.close}>When Charrette falls short of one of these, we treat it as a bug.</p>
    </div>
  )
}

/* The five inks, each shown where Charrette uses it. */
function Colours() {
  const rows: { ink: string; name: string; means: string; shown: ReactNode }[] = [
    {
      ink: 'var(--live)',
      name: 'Cobalt',
      means: 'Work in motion',
      shown: (
        <span className={s.live}>
          <TaskGlyph status={TaskStatus.Running} />
          Security review
        </span>
      ),
    },
    {
      ink: 'var(--signal)',
      name: 'Violet',
      means: 'A decision that waits on you',
      shown: (
        <span className={s.you}>
          <TaskGlyph status={TaskStatus.Yours} />
          Ready for you
        </span>
      ),
    },
    { ink: 'var(--ok)', name: 'Green', means: 'Added or merged', shown: <Delta add={48} /> },
    { ink: 'var(--danger)', name: 'Red', means: 'Removed or broken', shown: <Delta del={9} /> },
    {
      ink: 'var(--t-1)',
      name: 'Ink',
      means: 'Everything else',
      shown: (
        <span className={s.ink}>
          <TaskGlyph status={TaskStatus.Done} />
          Answered
        </span>
      ),
    },
  ]
  return (
    <div className={s.colours}>
      <dl className={s.key}>
        {rows.map((r) => (
          <div key={r.name} className={s.keyRow}>
            <dt className={s.keyName}>
              <i className={s.swatch} style={{ background: r.ink }} aria-hidden="true" />
              {r.name}
            </dt>
            <dd className={s.keyMeans}>{r.means}</dd>
            <dd className={s.keyShown}>{r.shown}</dd>
          </div>
        ))}
      </dl>
      <div className={s.statuses}>
        <WorkStatus running={3} yours={1} onYours={noop} />
        <WorkStatus running={3} yours={0} />
      </div>
    </div>
  )
}

/* One composer in one moment; type in it and its button follows. */
function Moment({ label, busy = false, initial = '' }: { label: string; busy?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div className={s.moment}>
      <span className={s.momentLabel}>{label}</span>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        onSendNow={() => setValue('')}
        placeholder={busy ? 'Add to the queue, or interrupt the lead' : 'Tell the lead'}
        busy={busy}
        onStopAgent={noop}
        hint="/"
        meter={<ContextRing used={122} total={1000} model={model('claude-opus-5')} />}
      />
    </div>
  )
}

function Moments() {
  return (
    <div className={s.moments}>
      <Moment label="Nothing written" />
      <Moment label="Something written" initial="Keep the limiter where it is, and add the test first." />
      <Moment label="The agent is working" busy />
      <Moment label="The agent is working, and you write" busy initial="Also check the webhook retry path." />
    </div>
  )
}

/* A pasted Linear link, the same card for another tracker, and the glyphs they share. */
function Trackers() {
  return (
    <div className={s.trackers}>
      <Issue {...MER_231} />
      <Issue
        mark={Brand.Jira}
        source="Jira"
        id="PAY-212"
        title="Refund webhooks retry too fast after a 429"
        href="https://meridian.atlassian.net/browse/PAY-212"
        status={{ state: IssueStatus.InProgress, label: 'In Progress' }}
        priority={{ level: IssuePriority.Medium, label: 'Medium' }}
        meta="Payments"
      />
      <div className={s.glyphs} aria-hidden="true">
        {Object.values(IssueStatus).map((x) => (
          <StatusGlyph key={x} status={x} />
        ))}
        <i className={s.glyphRule} />
        {Object.values(IssuePriority).map((x) => (
          <PriorityGlyph key={x} priority={x} />
        ))}
      </div>
    </div>
  )
}
