import { AcceptCard, Brand, BrandMark, Issue, IssuePriority, IssueStatus, TaskCard, TaskStatus } from '@althar/ui'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import { OPUS } from '../../../../../../packages/ui/src/fixtures/models'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import s from './Flow.module.css'

/*
 * Where work comes from and where it goes: an issue from your tracker
 * becomes a task, and the task ends as a pull request on your code host.
 * Three of each, in turn: Linear to GitHub, Jira to GitLab, Trello to
 * Bitbucket, drawn by the app's own issue, task and ready cards, joined by
 * a line that runs left to right as each comes in.
 */

const none = () => {}

interface Route {
  tracker: { brand: Brand; name: string }
  host: { brand: Brand; name: string }
  issue: ReactNode
  task: { task: string; title: string; branch: string; steps: string[] }
  pr: { repo: string; number: number; add: number; del: number; checks: number }
}

const ROUTES: Route[] = [
  {
    tracker: { brand: Brand.Linear, name: 'Linear' },
    host: { brand: Brand.GitHub, name: 'GitHub' },
    issue: (
      <Issue
        mark={Brand.Linear}
        source="Linear"
        id="MER-231"
        tone="linear"
        title="Backfill idempotency keys on refunds created before PR 1184"
        href="https://linear.app/meridian/issue/MER-231"
        status={{ state: IssueStatus.Todo, label: 'Todo' }}
        priority={{ level: IssuePriority.High, label: 'High' }}
        meta="Partner success"
      />
    ),
    task: {
      task: '432',
      title: 'Backfill idempotency keys on refunds created before PR 1184',
      branch: 'ch/432-backfill-idempotency',
      steps: ['Implement', 'Dry run', 'Review', 'Security review', 'Draft PR'],
    },
    pr: { repo: 'meridian-api', number: 1191, add: 212, del: 41, checks: 3 },
  },
  {
    tracker: { brand: Brand.Jira, name: 'Jira' },
    host: { brand: Brand.GitLab, name: 'GitLab' },
    issue: (
      <Issue
        mark={Brand.Jira}
        source="Jira"
        id="PAY-88"
        title="Partners see a 500 when a webhook signature has expired"
        href="https://meridian.atlassian.net/browse/PAY-88"
        status={{ state: IssueStatus.InProgress, label: 'In Progress' }}
        priority={{ level: IssuePriority.Urgent, label: 'Highest' }}
        meta="Payments · Sprint 41"
      />
    ),
    task: {
      task: '439',
      title: 'Answer an expired webhook signature with a 401, not a 500',
      branch: 'ch/439-expired-signature',
      steps: ['Implement', 'Review', 'Verify', 'Draft PR'],
    },
    pr: { repo: 'meridian-web', number: 412, add: 38, del: 6, checks: 5 },
  },
  {
    tracker: { brand: Brand.Trello, name: 'Trello' },
    host: { brand: Brand.Bitbucket, name: 'Bitbucket' },
    issue: (
      <Issue
        mark={Brand.Trello}
        source="Trello"
        id="Ops board"
        title="Rotate the staging database credentials every 30 days"
        href="https://trello.com/b/ops"
        status={{ state: IssueStatus.Backlog, label: 'This week' }}
        meta="Infrastructure"
      />
    ),
    task: {
      task: '441',
      title: 'Rotate staging database credentials on a 30-day schedule',
      branch: 'ch/441-rotate-staging-creds',
      steps: ['Implement', 'Review', 'Security review', 'Draft PR'],
    },
    pr: { repo: 'infra', number: 88, add: 64, del: 12, checks: 2 },
  },
]

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

export function Flow() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref, 0.35)
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  const route = ROUTES[at]!
  const pairs = useRef<Array<HTMLButtonElement | null>>([])
  const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  // The thumb sits under the route showing, and slides to the next.
  useLayoutEffect(() => {
    const place = () => {
      const el = pairs.current[at]
      if (el) setThumb({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [at])

  // Each route in turn, while it is in view.
  useEffect(() => {
    if (!seen || held || still()) return
    const timer = window.setTimeout(() => setAt((n) => (n + 1) % ROUTES.length), 5200)
    return () => window.clearTimeout(timer)
  }, [seen, held, at])

  return (
    <div ref={ref} className={cx(s.flow, seen && s.seen)} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <div className={s.switch}>
        <div className={s.pairs} role="group" aria-label="Trackers and code hosts">
          {thumb && (
            <span
              className={s.thumb}
              style={
                {
                  '--left': `${thumb.left}px`,
                  '--top': `${thumb.top}px`,
                  '--width': `${thumb.width}px`,
                  '--height': `${thumb.height}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            />
          )}
          {ROUTES.map((r, i) => (
            <button
              key={r.tracker.name}
              ref={(el) => void (pairs.current[i] = el)}
              type="button"
              className={cx(s.pair, i === at && s.on)}
              aria-pressed={i === at}
              onClick={() => setAt(i)}
            >
              <BrandMark brand={r.tracker.brand} size={18} />
              <span>{r.tracker.name}</span>
              <svg className={s.to} viewBox="0 0 16 8" width="16" height="8" aria-hidden="true">
                <path d="M0 4h14M11 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <BrandMark brand={r.host.brand} size={18} />
              <span>{r.host.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div key={at} className={s.row}>
        <div className={cx(s.col, s.c1)}>
          <p className={s.step}>
            <b>1</b> From your tracker
          </p>
          <Shot w={400} phoneW={380} label={`An issue in ${route.tracker.name}`} maxScale={1.15} frame={s.card}>
            {route.issue}
          </Shot>
        </div>
        <span className={cx(s.wire, s.w1)} aria-hidden="true" />
        <div className={cx(s.col, s.c2)}>
          <p className={s.step}>
            <b>2</b> A task in Althar
          </p>
          <Shot w={440} phoneW={380} label={`Task ${route.task.task}, done`} maxScale={1.15} frame={s.card}>
            <TaskCard
              task={route.task.task}
              title={route.task.title}
              status={TaskStatus.Done}
              steps={route.task.steps}
              at={route.task.steps.length}
              started="took 1h 18m"
              lead={OPUS}
              branch={route.task.branch}
            />
          </Shot>
        </div>
        <span className={cx(s.wire, s.w2)} aria-hidden="true" />
        <div className={cx(s.col, s.c3)}>
          <p className={s.step}>
            <b>3</b> To your host
          </p>
          <Shot w={340} phoneW={380} label={`A pull request on ${route.host.name}`} maxScale={1.15} frame={s.card}>
            <AcceptCard
              task={route.task.task}
              title={route.task.title}
              prs={[{ repo: route.pr.repo, number: route.pr.number, add: route.pr.add, del: route.pr.del }]}
              host={{ name: route.host.name, brand: route.host.brand }}
              checks={route.pr.checks}
              at="just now"
              onOpen={none}
            />
          </Shot>
        </div>
      </div>
    </div>
  )
}
