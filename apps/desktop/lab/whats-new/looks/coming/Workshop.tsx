import { type ReactNode, useEffect, useState } from 'react'

import {
  Board,
  BoardColumn,
  BoardDivider,
  BoardLane,
  BoardList,
  Brand,
  BrandMark,
  CallCard,
  Heading,
  LiveDot,
  NextRow,
  NextStep,
  Outcome,
  SettledRow,
  Wait,
  WorkCard,
} from '@althar/ui'

import { CODEX, OPUS, SONNET } from '../../../../../../packages/ui/src/fixtures/models'
import { LINKS } from '../../../../../site/src/content/facts'
import { COMMUNITY } from '../../../../src/renderer/shared/links'
import { dated, HIGHLIGHTS, NOW } from '../../notes'
import { inStage } from './roadmap'
import w from './workshop.module.css'

/*
 * Coming next, 5: the workshop. The roadmap is Althar's own project, built
 * in Althar, so Coming next is its board, in the kit's own lanes and cards:
 * what's being built now running, its lead and its step; what's next and
 * later up next; a call for the person, on what to build first; and what
 * 0.10.0 settled. Over it, what the work is doing as it does it. The leads,
 * steps and what they do are the lab's.
 */

/** What the running work does, one line at a time, as it happens. */
const FEED = [
  { who: Brand.ClaudeCode, what: 'Opus 5 pushed 2 commits to', where: 'althar/mobile-pairing' },
  { who: Brand.Codex, what: 'Codex ran the tests on', where: 'althar/mobile-pairing', after: '212 passed' },
  { who: Brand.ClaudeCode, what: 'Sonnet 5 reviewed', where: 'althar/mobile-threads', after: '1 finding, fixed' },
  { who: Brand.ClaudeCode, what: 'Opus 5 paged long threads in', where: 'althar/mobile-threads' },
] as const

function Feed() {
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setAt((now) => (now + 1) % FEED.length), 3200)
    return () => window.clearInterval(timer)
  }, [])
  const line = FEED[at] ?? FEED[0]
  return (
    <output className={w.feed} aria-live="off">
      <span className={w.feedLive}>
        <LiveDot pulse />
        Live
      </span>
      <span key={at} className={w.feedLine}>
        <BrandMark brand={line.who} size={13} />
        <span>
          {line.what} <code>{line.where}</code>
          {'after' in line && <span className={w.feedAfter}> · {line.after}</span>}
        </span>
      </span>
    </output>
  )
}

/** The row names its task by its title alone, as the app's board does. */
const UNNAMED = { task: () => '' }

const open = (href: string) => () => void window.open(href, '_blank', 'noreferrer')

export function Workshop({ back }: { back?: ReactNode }) {
  const now = inStage('now')
  const [now1, now2] = now
  const next = inStage('next')
  const later = inStage('later')
  // The second lead hands its change to review a moment after the board opens.
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setReviewing(true), 4200)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div className={w.page}>
      <header className={w.head}>
        {back !== undefined && <div className={w.back}>{back}</div>}
        <div className={w.headIn}>
          <div className={w.words}>
            <p className={w.kicker}>Coming next</p>
            <Heading level={1} className={w.title}>
              Althar, building Althar
            </Heading>
            <p className={w.why}>
              The roadmap is Althar’s own board. What’s running is being built now, on branches you can follow{' '}
              <a href={LINKS.repo} target="_blank" rel="noreferrer">
                on GitHub
              </a>
              .
            </p>
          </div>
          <Feed />
        </div>
      </header>
      <div className={w.board}>
        <Board label="Althar’s roadmap">
          <BoardColumn lane={BoardLane.Next} count={next.length + later.length}>
            <BoardList>
              {next.map((one, i) => (
                <NextRow
                  key={one.title}
                  place={i + 1}
                  task=""
                  text={UNNAMED}
                  kind="Change"
                  title={one.title}
                  wait={i === 0 ? Wait.Workers : Wait.After}
                  reason={i === 0 ? 'Next, once a lead is free' : `After ${next[0]?.title ?? ''}`}
                />
              ))}
            </BoardList>
            <BoardDivider>Later</BoardDivider>
            <BoardList>
              {later.map((one, i) => (
                <NextRow
                  key={one.title}
                  place={next.length + i + 1}
                  task=""
                  text={UNNAMED}
                  kind="Change"
                  title={one.title}
                  wait={Wait.After}
                  reason="Later; not planned yet"
                />
              ))}
            </BoardList>
          </BoardColumn>
          <BoardColumn lane={BoardLane.Running} count={now.length}>
            {now1 !== undefined && (
              <WorkCard
                task=""
                kind="Change"
                title={now1.title}
                steps={['Requirements', 'Implement', 'Review', 'Verify']}
                at={2}
                elapsed="41m"
                lead={OPUS}
                text={UNNAMED}
                onStep={[SONNET]}
              />
            )}
            {now2 !== undefined && (
              <WorkCard
                task=""
                kind="Change"
                title={now2.title}
                steps={['Plan', 'Implement', 'Review', 'Security review', 'Verify']}
                at={reviewing ? 2 : 1}
                elapsed={reviewing ? '1h 13m' : '1h 12m'}
                lead={OPUS}
                text={UNNAMED}
                {...(reviewing ? { onStep: [CODEX] } : {})}
              />
            )}
          </BoardColumn>
          <BoardColumn lane={BoardLane.Yours} count={1}>
            <CallCard
              kind="Question"
              title="What should the phone do first?"
              because="The mobile app is being built now. Say what you’d use it for first."
              options={['Answer what needs you', 'Follow a task as it runs', 'Merge a finished change']}
              from="Althar’s roadmap"
              next={
                <NextStep signal onPress={open(COMMUNITY)}>
                  Answer on Discord
                </NextStep>
              }
            />
          </BoardColumn>
          <BoardColumn lane={BoardLane.Settled} count={HIGHLIGHTS.length + 1}>
            <BoardList>
              {['Your own host, your own workers', ...HIGHLIGHTS.map((one) => one.name)].map((title) => (
                <SettledRow
                  key={title}
                  outcome={Outcome.Merged}
                  task=""
                  text={UNNAMED}
                  kind="Change"
                  title={title}
                  meta={`In ${NOW.version}`}
                  at={dated(NOW.date)}
                />
              ))}
            </BoardList>
          </BoardColumn>
        </Board>
      </div>
    </div>
  )
}
