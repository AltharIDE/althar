import { cx } from '../../../lib/cx'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Open.module.css'

/** The four beats of the panel, told beside the scene each one shows. */
const BEATS = [
  {
    k: 'The base',
    h: 'The whole product, open source, on your desktop.',
    t: 'Project memory, the coordinator and the agent adapters. Free for as long as you like, with your own agents and subscriptions. What the project knows is plain files in an open format, next to your code.',
  },
  {
    k: 'Built on top',
    h: 'Cloud for anyone who would rather not run it.',
    t: 'Small teams and large ones get shared memory, hosted runs and approvals from anywhere. Enterprises get it on their own infrastructure, supported. The same core runs underneath, so nothing is lost moving up or back down.',
  },
  {
    k: 'How it grows',
    h: 'Developers bring it in. Teams pay for it.',
    t: 'Developers adopt it free and pull in the cloud when their team shares a project. Every new adapter and every new user makes it more useful to the next developer.',
  },
  {
    k: 'What a lead checks',
    h: 'Where project knowledge lives is a choice for years.',
    t: 'So a lead asks hard questions before saying yes. Open source answers each one with something they can check, not a promise.',
  },
] as const

const TREE = [
  ['payments-service/', 0],
  ['src/', 1],
  ['.althar/', 1],
  ['memory/', 2],
  ['token-rotation.md', 3],
  ['refresh-window.md', 3],
  ['money-units.md', 3],
  ['tasks/418/', 2],
  ['graph.json', 3],
  ['evidence/', 3],
] as const

/** Beat one: the app on your own machine, and memory as a file you can open. */
function Desktop() {
  return (
    <div className={cx(s.scene, s.desk)}>
      <div className={s.win}>
        <div className={s.bar}>
          <i />
          <i />
          <i />
          <span>payments-service · Althar</span>
          <em>on this Mac</em>
        </div>
        <div className={s.pane}>
          <ul className={s.tree}>
            {TREE.map(([name, depth]) => (
              <li key={name} className={cx(name === 'token-rotation.md' && s.sel, name === '.althar/' && s.ours)} data-d={depth}>
                {name}
              </li>
            ))}
          </ul>
          <pre className={s.file}>
            <span className={s.fm}>---</span>
            {'\n'}
            <span className={s.fk}>status:</span> settled{'\n'}
            <span className={s.fk}>source:</span> your decision · task 418{'\n'}
            <span className={s.fk}>agents:</span> claude-code, codex{'\n'}
            <span className={s.fm}>---</span>
            {'\n\n'}A failed token rotation retries once,{'\n'}then fails the request.
          </pre>
        </div>
      </div>
      <ul className={s.chips}>
        <li>Runs on your desktop</li>
        <li>Plain files, open format</li>
        <li>Your agents, your subscriptions</li>
      </ul>
    </div>
  )
}

const LAYERS = [
  {
    k: 'Enterprise',
    h: 'Self-hosted, supported',
    t: 'SSO, audit and retention, on your own infrastructure',
    who: 'Organisations · licence',
    cls: 'ent',
  },
  {
    k: 'Althar Cloud',
    h: 'For teams, small and large',
    t: 'Shared memory, hosted runs, approvals from your phone',
    who: 'Teams · per seat',
    cls: 'cloud',
  },
  { k: 'Open source', h: 'Althar', t: 'The complete product, on your own machine', who: 'Anyone · free', cls: 'base' },
] as const

/** Beat two: what's sold, stacked on the same open core. */
function Stack() {
  return (
    <div className={cx(s.scene, s.stack)}>
      {LAYERS.map((l) => (
        <div key={l.k} className={cx(s.layer, s[l.cls])}>
          <div>
            <small>{l.k}</small>
            <b>{l.h}</b>
            <span>{l.t}</span>
          </div>
          <p className={s.who}>{l.who}</p>
        </div>
      ))}
      <p className={s.core}>
        <span>Same open core</span>
      </p>
    </div>
  )
}

const LOOP = ['A developer installs it', 'Uses it on a real project', 'The team shares the project', 'The team moves to Cloud'] as const

/** Beat three: the growth loop. */
function Loop() {
  return (
    <div className={cx(s.scene, s.loop)}>
      <p className={s.sk}>How it grows</p>
      <ol>
        {LOOP.map((l, j) => (
          <li key={l}>
            <span>{j + 1}</span>
            {l}
          </li>
        ))}
      </ol>
      <p className={s.back}>More adapters and more users bring the next developer in</p>
    </div>
  )
}

/** A platform team's vendor review: each question, the answer, and where to check it. */
const REVIEW = [
  ['Can we read what it does?', 'All of it: memory, coordinator and every adapter.', 'source, every line'],
  ['Where does project knowledge live?', 'In our repository, as Markdown, reviewed in pull requests like code.', '.althar/memory/*.md'],
  [
    'Does our code leave our network?',
    'Only to the model providers we already use. It can run entirely on our own infrastructure.',
    'self-hosted',
  ],
  ['Whose keys, whose bill?', 'Our existing subscriptions and API keys. No markup on compute.', 'bring your own keys'],
  ['What if the vendor goes away?', 'Pin a version or fork it. The memory still opens in any editor.', 'fork · pin · export'],
] as const

/** Beat four: the lead's due diligence, answered. */
function Review() {
  return (
    <div className={cx(s.scene, s.review)}>
      <div className={s.rvH}>
        <span>
          <b>Vendor review</b> Althar
        </span>
        <span>
          Platform team · {REVIEW.length} of {REVIEW.length} answered
        </span>
      </div>
      <ul className={s.rv}>
        {REVIEW.map(([q, a, e]) => (
          <li key={q}>
            <span className={s.ok} aria-hidden="true">
              ✓
            </span>
            <div>
              <b>{q}</b>
              <p>{a}</p>
            </div>
            <code>{e}</code>
          </li>
        ))}
      </ul>
      <p className={s.stamp}>No lock-in to weigh</p>
    </div>
  )
}

export function Open() {
  return (
    <Pin id="open" tone="light" name="Open source" className={s.open} steps={BEATS.length}>
      {(step) => (
        <div className={cx(ui.wrap, s.grid)} data-step={step}>
          <div>
            <p className={cx(ui.kicker, s.kicker)}>Why open source</p>
            <h2>Open source is the base. Everything we sell is built on top.</h2>
            <ol className={s.beats}>
              {BEATS.map((b, j) => (
                <li key={b.k} className={cx(j === step && s.on)}>
                  <span>
                    {String(j + 1).padStart(2, '0')} · {b.k}
                  </span>
                  <b>{b.h}</b>
                  <p>{b.t}</p>
                </li>
              ))}
            </ol>
          </div>
          <figure
            className={s.fig}
            aria-label="Althar on your desktop, the cloud and enterprise offerings built on it, how that grows, and a lead's review of it"
          >
            <Desktop />
            <Stack />
            <Loop />
            <Review />
          </figure>
        </div>
      )}
    </Pin>
  )
}
