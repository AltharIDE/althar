import { useEffect, useState } from 'react'

import { KeyValues, RunCard, Terminal } from '../../src'
import { GATES, PAST_RUNS, RUN_DONE, RUN_LINES } from './data'
import { Mono, Section, State } from './parts'
import s from './devops.module.css'

/*
 * A run in the run log: the approved apply on prod, as it prints, with Stop;
 * then how it ended, with its exit code, commit and target. An Ops task's
 * apply ends here, "ran, with this result": there is no pull request, as
 * what it applied was on main already.
 */

export type RunPhase = 'live' | 'stopped' | 'finished'

const gate = GATES.kubectl

export function RunLog({ phase: initial = 'live' }: { phase?: RunPhase }) {
  const [phase, setPhase] = useState<RunPhase>(initial)
  const [shown, setShown] = useState(initial === 'live' ? 2 : RUN_LINES.length)
  // The live one prints a line every second or so, then finishes by itself.
  useEffect(() => {
    if (phase !== 'live') return
    const timer = setInterval(() => setShown((n) => n + 1), 1400)
    return () => clearInterval(timer)
  }, [phase])
  useEffect(() => {
    if (phase === 'live' && shown > RUN_LINES.length) setPhase('finished')
  }, [phase, shown])

  const lines = phase === 'finished' ? RUN_DONE : RUN_LINES.slice(0, Math.min(shown, RUN_LINES.length))
  const ended =
    phase === 'live' ? undefined : phase === 'stopped' ? { code: 130, stopped: true } : { code: 0, stopped: false, last: RUN_DONE.at(-1) }

  return (
    <div className={s.runLog}>
      <header className={s.clusterHead}>
        <h1 className={s.pageTitle}>Run log</h1>
        <span className={s.read}>infra · every apply, on every environment</span>
      </header>

      <RunCard
        where={`${gate.title} · prod-eu1`}
        name="Apply on prod"
        command={gate.command}
        {...(phase === 'live' ? { url: 'prod-eu1 / payments', onStop: () => setPhase('stopped') } : {})}
        {...(ended === undefined ? {} : { ended })}
      />
      <Terminal
        command={gate.command}
        lines={phase === 'live' ? lines.slice(0, -1) : lines}
        {...(phase === 'live' ? { live: lines.at(-1) ?? '' } : {})}
        {...(ended?.code === undefined || ended.code === null ? {} : { exit: ended.code })}
        {...(phase === 'stopped' ? { failure: 'Stopped by you' } : {})}
      />

      <div className={s.result} data-phase={phase}>
        <KeyValues
          keyWidth={96}
          items={[
            [
              'Result',
              phase === 'live' ? (
                <State key="r" tone="live">
                  Running, 3 of 4 replicas
                </State>
              ) : phase === 'stopped' ? (
                <State key="r" tone="warm">
                  Stopped by you, exit 130. Kubernetes keeps rolling what it started
                </State>
              ) : (
                <State key="r" tone="ok">
                  Ran, exit 0, in 1m 12s
                </State>
              ),
            ],
            ['Target', <Mono key="t">prod-eu1 · payments · Deployment/refund-webhook</Mono>],
            [
              'Commit',
              <span key="c">
                <Mono>{gate.commit}</Mono> on <Mono>main</Mono>
              </span>,
            ],
            ['Approved', 'By you, 10:42'],
            ['Lock', phase === 'live' ? 'Held on prod by this run' : 'Let go'],
          ]}
        />
        {phase !== 'live' && (
          <p className={s.ending}>
            {phase === 'finished'
              ? 'Ran, with this result. Nothing to merge: the change was on main already. The task is done.'
              : 'Stopped, with this result. The task waits for you: run it again, or roll back with the last revision.'}
          </p>
        )}
      </div>

      <Section title="Earlier">
        <ul className={s.rows}>
          {PAST_RUNS.map((one) => (
            <li key={one.title + one.at} className={s.runRow}>
              <span className={s.envTag} data-env={one.env}>
                {one.env}
              </span>
              <span className={s.runTitle}>{one.title}</span>
              <Mono>{one.command}</Mono>
              <State tone={one.tone}>{one.says}</State>
              <span className={s.at}>{one.at}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
