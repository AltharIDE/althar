import { Button, NeedLine } from '@althar/ui'
import { Home, type HomeEvent } from '@althar/ui/screens'
import { cloneElement, isValidElement, type ReactNode, useRef } from 'react'

import { useStill } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { Crossfade } from './Crossfade'
import { Pointer } from './Pointer'
import { Tabs } from './app'
import app from './app.module.css'
import { useMarks } from './loop'
import { PHONE_WINDOW, Shot } from './Shot'
import s from './views.module.css'
import { DECISION, HALYARD, PROJECT_LIST, PUBLISH, READY, RUNNING, SIGNED_OUT, SINCE, STUCK, TALLY } from './world'

/** On a phone, how wide the window lays itself out: the home's list alone, as the app lays it out that narrow (views.module.css lets its projects go). */
const PHONE_W = 460

/*
 * The home you come back to, at work, as the app draws it: five calls across
 * projects, the tasks running and what happened since you looked. Played
 * through, each call is answered where it is, one after another: an agent
 * signed in, a stuck task started afresh, the permission allowed once, the
 * change accepted and merged, the decision taken. Each button is pressed a
 * moment before its line goes quiet and says what was said, the count of
 * what needs you comes down, and what was done joins what happened since
 * you looked. Then it plays back to the start, and again.
 */

const none = () => {}

const LABEL =
  'Althar’s home at work: a permission, a change ready to accept and a decision wait on you across projects; each is answered in turn where it is, while five tasks run'

/** When each call is pressed and answered, in ms into the story; and how long the story is. */
const ANSWER = { signin: 1300, stuck: 2600, publish: 3900, accept: 5200, decision: 6500 }
const PRESS = 420
export const HOME_STORY = 7600
/** Still: everything answered. */
const STILL = 7600

/** What each answer leaves in what happened since you looked, newest first. */
const DONE: Record<keyof typeof ANSWER, HomeEvent> = {
  signin: {
    id: 'd-signin',
    icon: 'check',
    project: SIGNED_OUT.project,
    what: 'Codex signed in',
    detail: 'the review on 88 carried on',
    at: 'now',
  },
  stuck: {
    id: 'd-stuck',
    icon: 'agents',
    project: STUCK.project,
    what: 'Spike C started afresh on Codex',
    detail: 'a different agent this time',
    at: 'now',
  },
  publish: {
    id: 'd-publish',
    icon: 'lock',
    project: HALYARD,
    what: 'Allowed the gateway’s release, once',
    detail: 'npm publish --tag next',
    at: 'now',
  },
  accept: {
    id: 'd-accept',
    icon: 'pr',
    project: TALLY,
    what: `Pull request #${READY.change.number} merged`,
    detail: 'checks passed',
    at: 'now',
  },
  decision: {
    id: 'd-decision',
    icon: 'check',
    project: TALLY,
    what: 'Refund retries queue with backoff',
    detail: 'the lead carries on',
    at: 'now',
  },
}

interface Said {
  kind: string
  said: string
  note: string
  denied?: boolean
}

const SAID: Record<keyof typeof ANSWER, Said> = {
  signin: { kind: 'Signed in', said: 'Codex', note: 'the review on 88 carries on' },
  stuck: { kind: 'Started afresh', said: 'On Codex', note: 'a different agent this time' },
  publish: { kind: 'Allowed', said: 'Once', note: 'in Halyard' },
  accept: { kind: 'Merged', said: `#${READY.change.number}`, note: 'checks passed, merged into main' },
  decision: { kind: 'Decided', said: DECISION.options[0]!.label, note: 'the lead carries on' },
}

/** The calls in the order they are answered, and how long before its press the pointer sets out for each. */
const ORDER = Object.keys(ANSWER) as (keyof typeof ANSWER)[]
const REACH = 620

/** The moments the view changes at: the pointer setting out, each button pressed, and each call answered. Drawn again only at these. */
const MARKS = Object.values(ANSWER).flatMap((at) => [at - PRESS - REACH, at - PRESS, at])

/** `active`: in front, so playing; behind, it holds where it is. */
export function HomeAtWork({ active = true }: { active?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null)
  const [ms] = useMarks(box, HOME_STORY, STILL, MARKS, active)
  const held = useStill()
  // The pointer: on its way to the next call's button once it is near, pressing it as it is pressed.
  const next = ORDER.find((id) => ms < ANSWER[id])
  const aim = next !== undefined && ms >= ANSWER[next] - PRESS - REACH ? `[data-act="${next}"]` : null
  const answered = (id: keyof typeof ANSWER) => ms >= ANSWER[id]
  const pressing = (id: keyof typeof ANSWER) => ms >= ANSWER[id] - PRESS && ms < ANSWER[id]
  const press = (id: keyof typeof ANSWER) => cx(s.press, pressing(id) && s.pressed)

  const cards: { id: keyof typeof ANSWER; project: (typeof PUBLISH)['project']; node: ReactNode }[] = [
    {
      id: 'signin',
      project: SIGNED_OUT.project,
      node: (
        <NeedLine
          kind={SIGNED_OUT.kind}
          project={SIGNED_OUT.project}
          task={SIGNED_OUT.task}
          title={SIGNED_OUT.title}
          brief={SIGNED_OUT.because}
          actions={
            <Button size="small" variant="signal" icon="terminal" className={press('signin')} data-act="signin" onClick={none}>
              Sign in to Codex
            </Button>
          }
        />
      ),
    },
    {
      id: 'stuck',
      project: STUCK.project,
      node: (
        <NeedLine
          kind={STUCK.kind}
          project={STUCK.project}
          task={STUCK.task}
          title={STUCK.title}
          brief={STUCK.because}
          actions={
            <>
              <Button size="small" onClick={none}>
                Stop the spike
              </Button>
              <Button size="small" variant="signal" className={press('stuck')} data-act="stuck" onClick={none}>
                Try it on Codex
              </Button>
            </>
          }
        />
      ),
    },
    {
      id: 'publish',
      project: PUBLISH.project,
      node: (
        <NeedLine
          kind={PUBLISH.kind}
          project={PUBLISH.project}
          task={PUBLISH.task}
          title={PUBLISH.title}
          command={PUBLISH.command}
          actions={
            <>
              <Button size="small" onClick={none}>
                Deny
              </Button>
              <Button size="small" variant="signal" className={press('publish')} data-act="publish" onClick={none}>
                Allow once
              </Button>
            </>
          }
        />
      ),
    },
    {
      id: 'accept',
      project: READY.project,
      node: (
        <NeedLine
          kind={READY.kind}
          project={READY.project}
          task={READY.task}
          title={READY.title}
          brief={`${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`}
          actions={
            <Button size="small" className={press('accept')} data-act="accept" onClick={none}>
              Accept and merge
            </Button>
          }
        />
      ),
    },
    {
      id: 'decision',
      project: DECISION.project,
      node: (
        <NeedLine
          kind={DECISION.kind}
          project={DECISION.project}
          task={DECISION.task}
          title={DECISION.title}
          brief={DECISION.options.map((o) => o.label).join('  or  ')}
          actions={
            <>
              <Button size="small" onClick={none}>
                {DECISION.options[1]!.label}
              </Button>
              <Button size="small" variant="signal" className={press('decision')} data-act="decision" onClick={none}>
                {DECISION.options[0]!.label}
              </Button>
            </>
          }
        />
      ),
    },
  ]
  const waiting = cards.filter((c) => !answered(c.id))
  const projects = PROJECT_LIST.map((p) => ({ ...p, yours: waiting.filter((c) => c.project.seed === p.id).length }))

  return (
    <div ref={box} className={s.wrap}>
      <Shot
        w={1440}
        h={780}
        phone={{ x: 170, y: 0, w: 780, h: 640 }}
        phoneW={PHONE_W}
        whole={PHONE_WINDOW}
        fill={{ phone: { x: 0, y: 0, w: PHONE_W }, tablet: { x: 150, y: 0, w: 840 } }}
        label={LABEL}
        frame={cx(s.frame, s.homeFit)}
      >
        <div className={app.window}>
          <Tabs current={null} />
          {/* What fades as its story starts over (loop.ts): the home, not the window's bar. */}
          <div className={app.home} data-fade="">
            {/* What changes on it passes from one to the other rather than snapping (Crossfade). */}
            <Crossfade still={held}>
              <Home
                waiting={waiting.length}
                running={RUNNING}
                since={[
                  ...(Object.keys(ANSWER) as (keyof typeof ANSWER)[])
                    .filter(answered)
                    .reverse()
                    .map((id) => DONE[id]),
                  ...SINCE,
                ]}
                looked="3 h ago"
                projects={projects}
                onOpenEvent={none}
                onOpenProject={none}
                onTalk={none}
                onNewProject={none}
                needs={cards.map(({ id, project, node }) => {
                  if (!answered(id)) return { key: id, project, line: node }
                  const said = SAID[id]
                  // Answered, a line stays where it was, quiet: its kind says which way, and what was said stands where its answers were.
                  return {
                    key: id,
                    project,
                    answered: true,
                    line: isValidElement<Parameters<typeof NeedLine>[0]>(node)
                      ? cloneElement(node, {
                          kind: said.kind,
                          actions: undefined,
                          answer: { said: said.said, note: said.note, ...(said.denied ? { denied: true } : {}) },
                        })
                      : node,
                  }
                })}
              />
            </Crossfade>
            <Pointer aim={aim} press={next !== undefined && pressing(next)} rest={[0.76, 0.86]} ms={ms} />
          </div>
        </div>
      </Shot>
    </div>
  )
}
