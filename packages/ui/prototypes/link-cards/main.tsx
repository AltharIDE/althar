import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import './proto.css'

import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Issue, type IssueProps } from '../../src/coordinator/Issue/Issue'
import { PriorityGlyph, StatusGlyph } from '../../src/coordinator/Issue/glyphs'
import { OPUS } from '../../src/fixtures/models'
import { Brand } from '../../src/foundations/brands/brands'
import { Icon } from '../../src/foundations/Icon/Icon'
import { BrandMark } from '../../src/foundations/Marks/Marks'
import { IssuePriority, IssueStatus } from '../../src/foundations/vocabulary'
import { Thread, ThreadMeasure } from '../../src/thread/Thread/Thread'
import { Prose, Turn } from '../../src/thread/Turn/Turn'
import { You } from '../../src/thread/You/You'

/* ---- fixtures ------------------------------------------------------------------------ */

type Link = IssueProps & { url: string }

const LINEAR: Link = {
  url: 'https://linear.app/althar/issue/DEV-68/run-the-agent-adapters-on-their-own-node-and-turn-the-runasnode-fuse-off',
  href: 'https://linear.app/althar/issue/DEV-68',
  mark: Brand.Linear,
  source: 'Linear',
  id: 'DEV-68',
  tone: 'linear',
  title: 'Run the agent adapters on their own Node, and turn the runAsNode fuse off',
  status: { state: IssueStatus.Todo, label: 'Todo' },
  priority: { level: IssuePriority.High, label: 'High' },
  meta: 'Development',
}

const PR: Link = {
  url: 'https://github.com/althar/althar/pull/131',
  href: 'https://github.com/althar/althar/pull/131',
  mark: Brand.GitHub,
  source: 'GitHub',
  id: '#131',
  title: 'Spawn the adapters with a bundled Node instead of ELECTRON_RUN_AS_NODE',
  meta: 'althar/althar · Open',
}

/** A message's words, with the links where they were pasted. */
type Seg = string | Link
interface Msg {
  id: string
  label: string
  segs: Seg[]
}

const SHORT: Msg = { id: 'short', label: 'A short message, one link', segs: ['Take this one next ', LINEAR] }
const LONG: Msg = {
  id: 'long',
  label: 'A long message, one link',
  segs: [
    'Before the release, can you pick up ',
    LINEAR,
    ' ? The adapters still spawn through Electron with ELECTRON_RUN_AS_NODE, so the runAsNode fuse has to stay on, and anyone with a shell on the Mac can run any Node they like as Althar. I’d like them on a bundled Node of their own, then the fuse flipped off in the forge config. Check that Claude and Codex both still start, and that the dev build works without the bundled binary.',
  ],
}
const TWO: Msg = {
  id: 'two',
  label: 'Two links, Linear and a GitHub pull request',
  segs: ['This is ', LINEAR, ' and the PR from last week got halfway there: ', PR, ' Pick up from where it stopped.'],
}
const MESSAGES = [SHORT, LONG, TWO]

const AGENT_SEGS: Seg[] = [
  'The adapters now start on the bundled Node, and Claude and Codex both come up. I’ve left the fuse on until the dev build has a fallback, and pushed it to ',
  PR,
  ' for review.',
]

const linksIn = (segs: Seg[]): Link[] => segs.filter((x): x is Link => typeof x !== 'string')
/** A link pasted last, with nothing after it but space or a stop: the card says it, so the words needn't. */
const trailing = (segs: Seg[], l: Link) => {
  const i = segs.indexOf(l)
  return segs.slice(i + 1).every((x) => typeof x === 'string' && /^[\s.!?]*$/.test(x))
}

/* ---- how a link reads in the words ----------------------------------------------------- */

type InText = 'url' | 'key' | 'chip'

function Words({ segs, as, onChip, open }: { segs: Seg[]; as: InText; onChip?: (l: Link) => void; open?: Link[] }) {
  return (
    <>
      {segs.map((x, i) => {
        if (typeof x === 'string') return <Fragment key={i}>{x.replace(/^ \?/, '?')}</Fragment>
        if (as === 'url')
          return (
            <span key={i} className="url">
              {x.url}
            </span>
          )
        if (as === 'key') {
          if (trailing(segs, x)) return null
          return (
            <a key={i} className="key" href={x.href} target="_blank" rel="noreferrer">
              {x.id}
            </a>
          )
        }
        return <Chip key={i} l={x} on={open?.includes(x) ?? false} onClick={() => onChip?.(x)} />
      })}
    </>
  )
}

/** D: the link as a chip in the words; the card on hover, kept open on a click. */
function Chip({ l, on, onClick }: { l: Link; on: boolean; onClick: () => void }) {
  return (
    <span className="chipWrap">
      <button type="button" className={`chip ${l.tone === 'linear' ? 'linear' : ''} ${on ? 'on' : ''}`} onClick={onClick}>
        <BrandMark brand={l.mark} size={11} />
        <span className="chipId">{l.id}</span>
        <span className="chipTitle">{l.title}</span>
      </button>
      {!on && (
        <span className="peek">
          <Issue {...l} href="" />
        </span>
      )}
    </span>
  )
}

/** E: one quiet line per link, in the bubble's foot. */
function Row({ l }: { l: Link }) {
  return (
    <a className={`row ${l.tone === 'linear' ? 'linear' : ''}`} href={l.href} target="_blank" rel="noreferrer">
      <span className="rowMark">
        <BrandMark brand={l.mark} size={12} />
      </span>
      <span className="rowId">{l.id}</span>
      <span className="rowTitle">{l.title}</span>
      <span className="rowMeta">
        {l.status && (
          <span title={l.status.label}>
            <StatusGlyph status={l.status.state} />
          </span>
        )}
        {l.priority && (
          <span title={l.priority.label}>
            <PriorityGlyph priority={l.priority.level} />
          </span>
        )}
        {!l.status && <span>{l.meta?.split(' · ').pop()}</span>}
      </span>
      <span className="peek up">
        <Issue {...l} href="" />
      </span>
    </a>
  )
}

/* ---- the person's message, each way ---------------------------------------------------- */

type Id = 'today' | 'a' | 'b' | 'c' | 'd' | 'e'

function Mine({ id, msg, at = 'just now' }: { id: Id; msg: Msg; at?: string }) {
  const links = linksIn(msg.segs)
  switch (id) {
    case 'today':
      return (
        <>
          <You at={at}>
            <Words segs={msg.segs} as="url" />
          </You>
          <div className="todayLinks">
            {links.map((l) => (
              <Issue key={l.url} {...l} />
            ))}
          </div>
        </>
      )
    case 'a':
      return (
        <article className="me" data-rhythm="you">
          <div className="bubble inside">
            <p className="words">
              <Words segs={msg.segs} as="key" />
            </p>
            <div className="cards">
              {links.map((l) => (
                <Issue key={l.url} {...l} />
              ))}
            </div>
          </div>
          <span className="at">{at}</span>
        </article>
      )
    case 'b':
      return (
        <article className="me" data-rhythm="you">
          <div className="stack above">
            <div className="cards">
              {links.map((l) => (
                <Issue key={l.url} {...l} />
              ))}
            </div>
            <div className="bubble">
              <p className="words">
                <Words segs={msg.segs} as="url" />
              </p>
            </div>
          </div>
          <span className="at">{at}</span>
        </article>
      )
    case 'c':
      return (
        <article className="me" data-rhythm="you">
          <div className="stack below">
            <div className="bubble">
              <p className="words">
                <Words segs={msg.segs} as="url" />
              </p>
            </div>
            <div className="cards">
              {links.map((l) => (
                <Issue key={l.url} {...l} />
              ))}
            </div>
          </div>
          <span className="at">{at}</span>
        </article>
      )
    case 'd':
      return <ChipMessage msg={msg} at={at} />
    case 'e':
      return (
        <article className="me" data-rhythm="you">
          <div className="bubble footed">
            <p className="words">
              <Words segs={msg.segs} as="key" />
            </p>
            <div className="foot">
              {links.map((l) => (
                <Row key={l.url} l={l} />
              ))}
            </div>
          </div>
          <span className="at">{at}</span>
        </article>
      )
  }
}

function ChipMessage({ msg, at }: { msg: Msg; at: string }) {
  const [open, setOpen] = useState<Link[]>([])
  const flip = (l: Link) => setOpen((o) => (o.includes(l) ? o.filter((x) => x !== l) : [...o, l]))
  return (
    <article className="me" data-rhythm="you">
      <div className={`bubble ${open.length > 0 ? 'inside' : ''}`}>
        <p className="words">
          <Words segs={msg.segs} as="chip" onChip={flip} open={open} />
        </p>
        {open.length > 0 && (
          <div className="cards">
            {open.map((l) => (
              <Issue key={l.url} {...l} />
            ))}
          </div>
        )}
      </div>
      <span className="at">{at}</span>
    </article>
  )
}

/* ---- the agent's, for contrast: it says a link in its own column, on the left ---------- */

function Theirs({ id }: { id: Id }) {
  const links = linksIn(AGENT_SEGS)
  const as: InText = id === 'd' ? 'chip' : id === 'a' || id === 'e' ? 'key' : 'url'
  const [open, setOpen] = useState<Link[]>([])
  return (
    <Turn model={OPUS} at="just now">
      <Prose>
        <Words segs={AGENT_SEGS} as={as === 'url' ? 'key' : as} open={open} onChip={(l) => setOpen((o) => (o.includes(l) ? [] : [l]))} />
      </Prose>
      {id === 'd' ? (
        open.map((l) => (
          <div key={l.url} className="agentCard">
            <Issue {...l} />
          </div>
        ))
      ) : id === 'e' ? (
        <div className="agentFoot">
          {links.map((l) => (
            <Row key={l.url} l={l} />
          ))}
        </div>
      ) : id === 'today' ? null : (
        links.map((l) => (
          <div key={l.url} className="agentCard">
            <Issue {...l} />
          </div>
        ))
      )}
    </Turn>
  )
}

/* ---- the directions -------------------------------------------------------------------- */

interface Direction {
  id: Id
  letter: string
  name: string
  pitch: string
  good: string[]
  costs: string[]
}

const DIRECTIONS: Direction[] = [
  {
    id: 'today',
    letter: '–',
    name: 'Today',
    pitch:
      'What ships: the bubble with the raw URL, its “just now”, and then the card under it at the thread’s full width. It belongs to no one.',
    good: ['Big, easy to read.'],
    costs: [
      'Comes after the timestamp, so it reads as a new, separate thing.',
      'Full width: neither right like you nor left like the agent.',
      'The raw URL and the card say the same thing twice.',
    ],
  },
  {
    id: 'a',
    letter: 'A',
    name: 'Inside the bubble',
    pitch:
      'The card renders in your bubble, under your words. A URL pasted at the end goes away (the card is the link); one mid-sentence becomes its key, DEV-68, as a link. The bubble widens to a card’s width when it carries one.',
    good: [
      'Unmistakably yours: the same tint, the same tail, the same stamp.',
      'No URL noise: the words read as you meant them.',
      'What chat apps do (iMessage, Slack), so nothing to learn.',
    ],
    costs: [
      'A short message becomes a wide bubble.',
      'Two links make a tall bubble.',
      'The card’s white sits on the grey tint: one more layer.',
    ],
  },
  {
    id: 'b',
    letter: 'B',
    name: 'Attached above',
    pitch:
      'The cards sit above the bubble, right-aligned, at the bubble’s width, like an attachment you sent with it (where images go today). The words keep the URL.',
    good: ['Matches where attachments already go: one rule for “things you sent”.', 'The bubble stays a bubble.'],
    costs: [
      'Card first reads as “a link, then what I said about it”; but the words usually come first in your head.',
      'Raw URL still in the words, so it says it twice.',
      'A short bubble stretches to the card’s width to line up.',
    ],
  },
  {
    id: 'c',
    letter: 'C',
    name: 'Under, as one message',
    pitch:
      'The cards hang from the bubble, right-aligned, at its width, 4px under it and before the timestamp; the bubble’s tail moves to the last card. One group, one stamp.',
    good: [
      'Smallest change from today: the same card, just placed and sized as yours.',
      'Order matches what you wrote: words, then what you linked.',
      'You already has an unfurl slot for exactly this.',
    ],
    costs: ['Raw URL still in the words.', 'The grouping is all spacing and corners: subtler than A.'],
  },
  {
    id: 'd',
    letter: 'D',
    name: 'Inline chip',
    pitch:
      'The URL becomes a chip where you pasted it: Linear’s mark, DEV-68 and the title. Hover for the card; click to keep it open inside the bubble.',
    good: ['The message stays as small as you wrote it.', 'The link is where you put it in the sentence.', 'Scales to many links.'],
    costs: [
      'Status and priority are a hover away: the card’s glance is lost.',
      'Hover does nothing on a glance down the thread.',
      'A long title in a chip fights the words around it.',
    ],
  },
  {
    id: 'e',
    letter: 'E',
    name: 'The bubble’s foot',
    pitch:
      'My own: the URL becomes its key in the words, and each link gets one quiet line at the bottom of the bubble, under a hairline: mark, key, title, status and priority as glyphs. Hover a line for the full card.',
    good: [
      'Inside the bubble, so as clearly yours as A.',
      'One line a link: two links cost 64px, not 150.',
      'Keeps the at-a-glance state (Todo, High) A and C give, unlike D.',
    ],
    costs: ['A new, smaller unfurl to keep beside the card.', 'Linear’s field of squares and colour get a mark’s worth of room only.'],
  },
]

/* ---- pages ----------------------------------------------------------------------------- */

function Window({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <div className="window" style={width ? { width } : undefined}>
      <ThreadMeasure>
        <Thread label="Task">{children}</Thread>
      </ThreadMeasure>
    </div>
  )
}

function DirectionPage({ d }: { d: Direction }) {
  return (
    <>
      <div className="head">
        <span className="letter">{d.letter}</span>
        <div>
          <h1>{d.name}</h1>
          <p className="pitch">{d.pitch}</p>
        </div>
      </div>
      <div className="proscons">
        <ul className="good">
          {d.good.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <ul className="costs">
          {d.costs.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <section className="part">
        <h2>In a thread</h2>
        <Window>
          <Turn model={OPUS} at="4m ago">
            <Prose>The release branch is cut. Anything else before I start on the notes?</Prose>
          </Turn>
          <Mine id={d.id} msg={LONG} at="2m ago" />
          <Theirs id={d.id} />
          <Mine id={d.id} msg={SHORT} />
        </Window>
      </section>
      {MESSAGES.map((m) => (
        <section key={m.id} className="part">
          <h2>{m.label}</h2>
          <Window>
            <Mine id={d.id} msg={m} />
          </Window>
        </section>
      ))}
      <section className="part">
        <h2>A link in the agent’s message, for contrast</h2>
        <Window>
          <Mine id={d.id} msg={SHORT} at="3m ago" />
          <Theirs id={d.id} />
        </Window>
      </section>
    </>
  )
}

function Compare() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Side by side</h1>
          <p className="pitch">
            The same two messages each way: your two-link message, then the agent’s answer with its link. Narrower than the real thread
            (460px), as in a split window. Each letter opens its page.
          </p>
        </div>
      </div>
      <div className="compare">
        {DIRECTIONS.map((d) => (
          <div key={d.id} className="cell">
            <a className="cellHead" href={`#${d.id}`}>
              <span className="letter small">{d.letter}</span>
              {d.name}
            </a>
            <Window>
              <Mine id={d.id} msg={TWO} />
              <Mine id={d.id} msg={SHORT} />
              <Theirs id={d.id} />
            </Window>
          </div>
        ))}
      </div>
      <section className="part pick">
        <h2>My pick</h2>
        <p>
          <b>A, inside the bubble</b>, with E’s single lines once a message carries two or more links. The card in the bubble is the only
          placement where ownership isn’t carried by spacing alone, and dropping the trailing URL makes the message read as you wrote it.
        </p>
      </section>
    </>
  )
}

function App() {
  const read = () => (window.location.hash.slice(1) || 'compare') as Id | 'compare'
  const [page, setPage] = useState(read)
  useEffect(() => {
    const on = () => {
      setPage(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const d = DIRECTIONS.find((x) => x.id === page)
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">Link cards</div>
        <a href="#compare" className={page === 'compare' ? 'on' : ''}>
          <Icon name="list" size={13} /> Side by side
        </a>
        {DIRECTIONS.map((x) => (
          <a key={x.id} href={`#${x.id}`} className={page === x.id ? 'on' : ''}>
            <span className="letter small">{x.letter}</span> {x.name}
          </a>
        ))}
      </nav>
      <main className="main">{d ? <DirectionPage key={d.id} d={d} /> : <Compare />}</main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
