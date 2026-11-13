import type { ReactNode } from 'react'

import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import s from './Privacy.module.css'

/*
 * What Althar and this site send, and to whom: the night window the other
 * pages open on, the date and the two answers people look for first along
 * its top, and the page itself on the thesis's cream paper under it, one
 * reading column. Every claim here is what the app's code does
 * (apps/desktop/src/main/usageData.ts, crashReports.ts, report/); change
 * this page when that changes.
 */

/** When this page last changed. */
const UPDATED = '8 Nov 2026'

interface Part {
  id: string
  title: string
  body: ReactNode
}

const PARTS: Part[] = [
  {
    id: 'short',
    title: 'The short version',
    body: (
      <>
        <p>
          Althar runs on your computer. Your code, your prompts and what your agents write stay there, or go to the agents’ own providers,
          under your own accounts. Althar has no account of its own and no server that sees your work.
        </p>
        <p>
          The app sends two small things, both anonymous and both on until you turn them off: <strong>usage data</strong>, the steps people
          take, and <strong>crash reports</strong>, what failed in Althar’s own code. A <strong>problem report</strong> goes only when you
          write one and press send. This site sets no cookies and runs no analytics.
        </p>
      </>
    ),
  },
  {
    id: 'usage',
    title: 'Usage data',
    body: (
      <>
        <p>
          To see whether Althar works for the people who try it, the app records a few steps, each with a few plain properties, and nothing
          else:
        </p>
        <ul className={s.ul}>
          <li>Althar opened, and updated from a version</li>
          <li>The first project made, and each project after, with how many repositories</li>
          <li>An agent signed in, by its name: Claude Code, Codex</li>
          <li>A task started and settled: how, which agent and model family, in how many steps, and roughly how long it took</li>
          <li>An ask answered, and by whom: you or the coordinator</li>
          <li>An agent’s account reaching its usage limit</li>
        </ul>
        <p>
          Each carries Althar’s version, the system and the processor, and a random id made for this install. It never carries a path, a
          repository’s or project’s name, a prompt, a message, what an agent wrote, a file or an account. The app drops anything else before
          it sends.
        </p>
      </>
    ),
  },
  {
    id: 'crashes',
    title: 'Crash reports',
    body: (
      <>
        <p>
          When something in Althar fails, the app sends what failed and where in Althar’s code: the error, the lines of the stack, which of
          its processes, the version and the system. For a native crash, only that it happened, when and in which process; the crash dump
          stays on your computer.
        </p>
        <p>
          Before a report goes, the app masks paths under your home folder, your projects’ and repositories’ names, your name on the
          computer, email addresses and anything that looks like a key or a token. At most a few go each launch, and the same one once.
        </p>
      </>
    ),
  },
  {
    id: 'where',
    title: 'Where they go, and how to stop them',
    body: (
      <>
        <p>
          Usage data and crash reports go to <a href="https://posthog.com">PostHog</a>, in the US, straight from the app. They are
          anonymous: no profile is made of you, your address isn’t used to place you, and the install id is random, so nothing ties them to
          you or your machine.
        </p>
        <p>
          Each has its own switch in Settings, and the first screen shows the crash reports one. With either off, the app sends nothing for
          it. Both stay off while <code>DO_NOT_TRACK</code> is set, and builds you make yourself never send either.
        </p>
        <p>Because nothing names you, we can’t find your events to delete them. Turning the switch off stops new ones.</p>
      </>
    ),
  },
  {
    id: 'reports',
    title: 'Problem reports',
    body: (
      <>
        <p>
          You can send a problem report from the app. It holds what you write, the email if you give one, and facts about the app: the
          versions, the screen you were on, your agents and the last errors. A screenshot and the tail of the logs go too, unless you leave
          them out, and you can see all of it before sending. The logs are masked like crash reports.
        </p>
        <p>
          It goes through Althar’s report service on Cloudflare into our issue tracker, <a href="https://linear.app">Linear</a>, where only
          the team reads it. We use the email only to reply. Ask, and we’ll delete the report.
        </p>
      </>
    ),
  },
  {
    id: 'others',
    title: 'What else the app talks to',
    body: (
      <>
        <ul className={s.ul}>
          <li>
            <strong>Your agents’ providers.</strong> Claude Code talks to Anthropic, Codex to OpenAI, and so on, under your own account and
            their own terms. Althar sits on your computer beside them and passes nothing to us.
          </li>
          <li>
            <strong>Where your code and tickets live.</strong> GitHub, GitLab or Bitbucket, Linear, Jira or Trello, on their sites or your
            own servers: only the ones you connect, with the access you give them, and git’s own remotes as you push and pull.
          </li>
          <li>
            <strong>GitHub’s releases</strong>, to check for updates to Althar and to the agents it installs.
          </li>
          <li>
            <strong>OpenRouter</strong>, for the public list of models and what they cost. No account, nothing of yours.
          </li>
          <li>
            <strong>Hugging Face</strong>, once, to download the speech model when you first dictate. Dictation itself runs on your
            computer; what you say never leaves it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'site',
    title: 'This website',
    body: (
      <>
        <p>
          althar.ai sets no cookies and runs no analytics or tracking scripts. It’s served by Cloudflare, which keeps the usual short-lived
          request logs to run and protect the site. The download button asks GitHub, from your browser, for the latest release.
        </p>
      </>
    ),
  },
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          Althar is an open-source project, not a company yet. There is no legal entity behind it and nothing is sold. When that changes,
          this page will say who is responsible for your data, and how.
        </p>
        <p>
          For a question, or to have a problem report deleted, <a href={LINKS.issues}>open an issue on GitHub</a>. The code that sends all
          of the above is in the <a href={LINKS.repo}>repository</a>, to read for yourself.
        </p>
      </>
    ),
  },
]

export function Privacy() {
  return (
    <div className={s.page}>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Night head>
          <Window
            className={s.window}
            deck={
              <>
                <Readout label="Updated" href={`${LINKS.repo}/commits/main/apps/site/src/privacy/Privacy.tsx`}>
                  <b>{UPDATED}</b>
                </Readout>
                <Readout label="Cookies" href="#site" at="mid">
                  <b>None</b>
                </Readout>
                <Readout label="Accounts" href="#short" at="end">
                  <b>None</b>
                </Readout>
              </>
            }
          >
            <div className={n.head}>
              <p className={n.over}>
                <span className={n.overLit}>Privacy</span>
                <span>What Althar sends, and to whom</span>
              </p>
              <h1 className={n.headline}>Your work stays on your computer.</h1>
            </div>
          </Window>
        </Night>

        <article className={s.article}>
          {PARTS.map((p, i) => (
            <section key={p.id} id={p.id} className={s.part} aria-labelledby={`${p.id}-h`}>
              <h2 id={`${p.id}-h`} className={s.h2}>
                <span className={s.no}>{String(i + 1).padStart(2, '0')}</span>
                {p.title}
              </h2>
              {p.body}
            </section>
          ))}
        </article>
      </main>

      <Footer />
    </div>
  )
}
