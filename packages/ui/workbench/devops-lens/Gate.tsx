import { useState } from 'react'

import { CopyButton, Diff, DiffLineKind, Field, Icon, KeyValues, NextStep, NextSteps } from '../../src'
import { GATES, type Gate, type GateKind } from './data'
import { Dot, Mono, State } from './parts'
import s from './devops.module.css'

/*
 * The gate (DEV-284, ADR-111): an Ops task asks to apply on an environment.
 * What each environment asks:
 *   prod     the person approves or refuses, on this card.
 *   staging  the coordinator decides, by the plan; the card says why.
 *   dev      it runs; the card says it ran.
 * The card always shows the same five things: the dry run's diff or plan,
 * the exact command, the target, the commit, and who decided.
 */

export type GateMode = 'prod' | 'staging' | 'dev'
export type Answer = 'asked' | 'approved' | 'refused'

/** The staging one: Saved carts' helm upgrade, which the coordinator let through. */
const STAGING: Gate = {
  kind: 'kubectl',
  task: 'Saved carts rollout',
  title: 'Turn on saved carts on staging',
  env: 'staging',
  command: 'helm upgrade storefront charts/storefront -f values/staging.yaml --atomic',
  target: [
    ['Context', 'staging-eu1'],
    ['Namespace', 'storefront'],
    ['Release', 'storefront'],
  ],
  commit: 'c41e9a2',
  branch: 'main',
  summary: 'helm diff upgrade: 2 objects change',
  path: 'values.yaml',
  diff: [
    { kind: DiffLineKind.Hunk, text: '@@ ConfigMap/storefront/feature-flags (keys only) @@' },
    { kind: DiffLineKind.Added, new: 12, text: '  saved_carts: <changed>' },
    { kind: DiffLineKind.Hunk, text: '@@ Deployment/storefront/cart-api @@' },
    { kind: DiffLineKind.Removed, old: 31, text: '        image: cart-api:8b07d13' },
    { kind: DiffLineKind.Added, new: 31, text: '        image: cart-api:c41e9a2' },
  ],
}

const DEV: Gate = {
  ...STAGING,
  title: 'Turn on saved carts on dev',
  env: 'dev',
  command: STAGING.command.replace('staging', 'dev'),
  target: [['Context', 'dev-eu1'], ...STAGING.target.slice(1)],
}

export function GateCard({
  mode = 'prod',
  kind = 'kubectl',
  locked = false,
  answer: initial = 'asked',
}: {
  mode?: GateMode
  kind?: GateKind
  /** Prod is locked by someone else: approving queues the run behind their lock. */
  locked?: boolean
  answer?: Answer
}) {
  const gate = mode === 'prod' ? GATES[kind] : mode === 'staging' ? STAGING : DEV
  const [answer, setAnswer] = useState<Answer>(initial)
  const [refusing, setRefusing] = useState(false)
  const [why, setWhy] = useState('')

  const head =
    mode === 'prod'
      ? { tone: answer === 'refused' ? ('quiet' as const) : ('signal' as const), word: 'Apply on prod', at: '2m' }
      : mode === 'staging'
        ? { tone: 'live' as const, word: 'Applying on staging', at: '3m' }
        : { tone: 'ok' as const, word: 'Applied on dev', at: '6m' }

  return (
    <article className={s.gate} data-env={gate.env} aria-label={`${head.word}: ${gate.title}`}>
      <div className={s.gateTop}>
        <span className={s.gateWord} data-tone={head.tone}>
          {head.tone === 'signal' ? <Icon name="lock" size={12} /> : <Dot tone={head.tone === 'live' ? 'live' : head.tone} />}
          {head.word}
        </span>
        <span className={s.gateTask}>{gate.task}</span>
        <span className={s.at}>{head.at}</span>
      </div>
      <h3 className={s.gateTitle}>{gate.title}</h3>

      {mode === 'dev' ? (
        <details className={s.gateFold}>
          <summary>{gate.summary}</summary>
          <Diff lines={gate.diff} label={gate.summary} path={gate.path} />
        </details>
      ) : (
        <div className={s.gateDiff}>
          <div className={s.gateDiffHead}>
            <Icon name="list" size={12} />
            {gate.summary}
            <span className={s.dryRun}>dry run, 2m ago</span>
          </div>
          <Diff lines={gate.diff} label={gate.summary} path={gate.path} />
        </div>
      )}

      <div className={s.command}>
        <code>{gate.command}</code>
        <CopyButton value={gate.command} ghost />
      </div>

      <KeyValues
        keyWidth={96}
        className={s.facts}
        items={[
          ...gate.target.map(([key, value]) => [key, <Mono key={key}>{value}</Mono>] as const),
          [
            'Commit',
            <span key="c" className={s.inline}>
              <Mono>{gate.commit}</Mono> on <Mono>{gate.branch}</Mono>, checks passed
            </span>,
          ],
          [
            'Lock',
            locked && mode === 'prod' ? (
              <State key="l" tone="warm">
                Balázs holds prod for the Postgres window, 41m. Approved, it runs after.
              </State>
            ) : mode === 'prod' ? (
              <span key="l">Free. The run takes it, and lets go when it ends.</span>
            ) : mode === 'staging' ? (
              <span key="l">Held by this run, 3m</span>
            ) : (
              <span key="l">Not locked: dev runs at once</span>
            ),
          ],
          ...(mode === 'staging'
            ? [
                [
                  'Decided',
                  <span key="d">
                    By the coordinator: the dry run matches <Mono>specs/saved-carts/ops.md</Mono>, and staging allows it
                  </span>,
                ] as const,
              ]
            : mode === 'dev'
              ? [
                  [
                    'Result',
                    <State key="r" tone="ok">
                      Ran, exit 0, in 41s
                    </State>,
                  ] as const,
                ]
              : []),
        ]}
      />

      {mode === 'prod' && answer === 'asked' && refusing && (
        <div className={s.refuse}>
          <Field
            value={why}
            onChange={(e) => setWhy(e.currentTarget.value)}
            placeholder="Why, for the task (optional)"
            aria-label="Why you refuse"
            autoFocus
          />
        </div>
      )}

      {mode === 'prod' && answer === 'asked' && (
        <NextSteps className={s.gateSteps}>
          {refusing ? (
            <>
              <NextStep onPress={() => setRefusing(false)}>Back</NextStep>
              <NextStep onPress={() => setAnswer('refused')}>Refuse</NextStep>
            </>
          ) : (
            <>
              <NextStep onPress={() => setRefusing(true)}>Refuse</NextStep>
              <NextStep signal onPress={() => setAnswer('approved')}>
                {locked ? 'Approve, run after the lock' : 'Approve and run'}
              </NextStep>
            </>
          )}
        </NextSteps>
      )}
      {mode === 'prod' && answer === 'approved' && (
        <p className={s.gateAfter}>
          {locked ? (
            <State tone="warm">You approved. Queued behind Balázs’s lock</State>
          ) : (
            <State tone="live">You approved. Running on prod-eu1</State>
          )}
        </p>
      )}
      {mode === 'prod' && answer === 'refused' && (
        <p className={s.gateAfter}>
          <State tone="quiet">You refused. The task has your reason{why === '' ? '' : `: “${why}”`}</State>
        </p>
      )}
      {mode === 'staging' && (
        <NextSteps className={s.gateSteps}>
          <NextStep onPress={() => undefined}>Stop</NextStep>
          <NextStep arrow>Open the run</NextStep>
        </NextSteps>
      )}
    </article>
  )
}
