import type { ReactNode } from 'react'
import { fn } from 'storybook/test'

import {
  BoardCard,
  Button,
  ChromeButton,
  Fact,
  Icon,
  IconButton,
  NextStep,
  NextSteps,
  ProjectHeader,
  ProjectInk,
  ProjectTabs,
  Room,
  TaskStatus,
} from '../../src'
import { ALERTS, DEPLOYS, ENVIRONMENTS, GATES, HANDOFFS, WORKLOADS } from './data'
import { Dot, Mono, Section, State } from './parts'
import s from './devops.module.css'

/*
 * The DevOps home: the project's environments with their locks, what needs
 * DevOps (the prod gate and the handoffs from Build), what fires, the
 * cluster at a glance and the deploys. Problems and what to do first, what's
 * fine after (DESIGN.md: order by urgency).
 */

export function Window({ children, project = 'infra' }: { children: ReactNode; project?: string }) {
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={[
          { id: 'storefront', name: 'storefront', seed: 'storefront', ink: ProjectInk.Clay, running: true, yours: 1 },
          { id: 'infra', name: 'infra', seed: 'infra', ink: ProjectInk.Teal, running: true, yours: 3 },
        ]}
        current={project}
        yours={4}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" size="small" />}
      />
      <ProjectHeader
        name="infra"
        seed="infra"
        ink={ProjectInk.Teal}
        yours={3}
        inProgress={2}
        onYours={fn()}
        room={Room.Board}
        onRoom={fn()}
        run={<ChromeButton icon="viewport" label="DevOps" count={3} aria-label="Lens: DevOps, 3 wait on you" />}
      />
      <div className={s.body}>{children}</div>
    </div>
  )
}

export function DevOpsHome() {
  const gate = GATES.kubectl
  const unhealthy = WORKLOADS.filter((one) => one.ready < one.desired)
  return (
    <Window>
      <div className={s.home}>
        <div className={s.envs} role="list" aria-label="Environments">
          {ENVIRONMENTS.map((env) => (
            <article key={env.env} className={s.env} role="listitem" aria-label={env.name}>
              <header className={s.envHead}>
                <span className={s.envName}>{env.name}</span>
                <State tone={env.health.tone}>{env.health.says}</State>
              </header>
              <dl className={s.envFacts}>
                <dt>Runs</dt>
                <dd>
                  <Mono>{env.commit}</Mono> · {env.deployed}
                </dd>
                <dt>Applies</dt>
                <dd>{env.gate}</dd>
                <dt>Lock</dt>
                <dd>
                  {env.lock === null ? (
                    <span className={s.free}>Free</span>
                  ) : (
                    <span className={s.held} title={`${env.lock.by}: ${env.lock.for}`}>
                      <Icon name="lock" size={11} />
                      <b>{env.lock.by}</b>
                      <span className={s.heldFor}>{env.lock.for}</span>
                      <span className={s.at}>{env.lock.since}</span>
                    </span>
                  )}
                </dd>
              </dl>
            </article>
          ))}
        </div>

        <div className={s.columns}>
          <div className={s.col}>
            <Section title="Waiting on you" aside="3">
              <div className={s.cards}>
                <BoardCard
                  status={TaskStatus.Yours}
                  word="Apply on prod"
                  at="2m"
                  title={gate.title}
                  why={gate.command}
                  foot={
                    <>
                      <Fact icon="list">kubectl diff: 1 object</Fact>
                      <Fact tone="warm" icon="lock">
                        Prod held by Balázs
                      </Fact>
                    </>
                  }
                  next={
                    <NextSteps>
                      <NextStep onPress={fn()}>Refuse</NextStep>
                      <NextStep signal onPress={fn()}>
                        Approve
                      </NextStep>
                    </NextSteps>
                  }
                  onOpen={fn()}
                />
                {HANDOFFS.map((one) => (
                  <BoardCard
                    key={one.feature}
                    status={TaskStatus.Yours}
                    word="Build → Ship"
                    at={one.ago}
                    title={one.feature}
                    why={one.facts}
                    foot={<Fact icon="file">{one.plan}</Fact>}
                    next={
                      <NextSteps>
                        <NextStep arrow>Read the plan</NextStep>
                        <NextStep signal onPress={fn()}>
                          Start
                        </NextStep>
                      </NextSteps>
                    }
                    onOpen={fn()}
                  />
                ))}
              </div>
            </Section>

            <Section title="Deploys" aside={<a className={s.more}>Run log</a>}>
              <ul className={s.rows}>
                {DEPLOYS.map((one) => (
                  <li key={one.title + one.at + one.env} className={s.deployRow}>
                    <span className={s.envTag} data-env={one.env}>
                      {one.env}
                    </span>
                    <span className={s.runTitle}>{one.title}</span>
                    <Mono>{one.commit}</Mono>
                    <State tone={one.state.tone}>{one.state.says}</State>
                    <span className={s.at}>{one.at}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div className={s.col}>
            <Section title="Alerts" aside="Prometheus">
              <ul className={s.rows}>
                {ALERTS.map((one) => (
                  <li key={one.id} className={s.alertRow}>
                    <Dot tone={one.severity === 'critical' ? 'danger' : 'warm'} />
                    <span className={s.alertText}>
                      <span className={s.alertName}>
                        {one.name}
                        <span className={s.envTag} data-env={one.env}>
                          {one.env}
                        </span>
                      </span>
                      <span className={s.alertSummary}>{one.summary}</span>
                    </span>
                    <span className={s.at}>{one.since}</span>
                    <Button size="small" variant="quiet" className={s.hoverAct}>
                      Investigate
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Cluster" aside={<Mono>prod-eu1</Mono>}>
              <div className={s.stats}>
                <Stat label="Nodes" value="6/6" says="ready" />
                <Stat label="Workloads" value="4/5" says="healthy" tone="danger" />
                <Stat label="Failing pods" value="2" says="CrashLoopBackOff" tone="danger" />
                <Stat label="Restarts" value="15" says="in the last hour" tone="warm" />
              </div>
              <ul className={s.rows}>
                {unhealthy.map((one) => (
                  <li key={one.name} className={s.deployRow}>
                    <Dot tone="danger" />
                    <span className={s.runTitle}>
                      {one.namespace}/{one.name}
                    </span>
                    <span className={s.num}>
                      {one.ready}/{one.desired}
                    </span>
                    <State tone={one.rollout.tone}>{one.rollout.says}</State>
                    <Icon name="chevron" size={12} />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      </div>
    </Window>
  )
}

function Stat({ label, value, says, tone }: { label: string; value: string; says: string; tone?: 'danger' | 'warm' }) {
  return (
    <div className={s.stat} data-tone={tone}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
      <span className={s.statSays}>{says}</span>
    </div>
  )
}
