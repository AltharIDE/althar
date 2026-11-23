import { useState } from 'react'

import { Button, Icon, KeyValues, NextStep, NextSteps } from '../../src'
import { ALERTS } from './data'
import { Mono, State } from './parts'
import s from './devops.module.css'

/*
 * An alert becoming a task: from a firing alert, Investigate drafts an
 * incident task with the cluster panel's facts attached, read at that
 * moment, so the task starts from what was true when the alert fired.
 * It starts as an Ops task that may read prod and apply only through the gate.
 */

const alert = ALERTS[0]!

export function AlertToTask({ drafted: initial = false }: { drafted?: boolean }) {
  const [drafted, setDrafted] = useState(initial)
  return (
    <div className={s.alertFlow}>
      <article className={s.alert} aria-label={`Alert ${alert.name}`}>
        <div className={s.gateTop}>
          <span className={s.gateWord} data-tone="danger">
            <Icon name="bell" size={12} />
            Firing on prod
          </span>
          <span className={s.gateTask}>Prometheus · Alertmanager</span>
          <span className={s.at}>{alert.since}</span>
        </div>
        <h3 className={s.gateTitle}>
          {alert.name} <span className={s.severity}>{alert.severity}</span>
        </h3>
        <p className={s.alertSays}>{alert.summary}</p>
        <KeyValues
          keyWidth={70}
          items={[
            ['Labels', <Mono key="l">{alert.labels}</Mono>],
            ['Value', alert.value],
          ]}
        />
        <div className={s.alertActions}>
          <Button size="small" variant="quiet" icon="clock">
            Silence 1h
          </Button>
          <Button size="small" variant="quiet" icon="external">
            Runbook
          </Button>
          <Button size="small" variant={drafted ? 'quiet' : 'signal'} icon="search" onClick={() => setDrafted(true)} disabled={drafted}>
            {drafted ? 'Drafted' : 'Investigate'}
          </Button>
        </div>
      </article>

      {drafted && (
        <article className={s.draft} aria-label="Incident task, drafted">
          <div className={s.gateTop}>
            <span className={s.gateWord} data-tone="signal">
              <Icon name="create" size={12} />
              Incident task, drafted
            </span>
            <span className={s.gateTask}>Ops · reads prod, applies through the gate</span>
          </div>
          <h3 className={s.gateTitle}>refund-webhook crash-loops on prod</h3>
          <p className={s.alertSays}>
            Find why refund-webhook is OOMKilled since revision 7, and propose a fix. Anything on prod comes back to you to approve.
          </p>
          <div className={s.attached}>
            <div className={s.attachedHead}>
              <Icon name="clip" size={12} />
              From the cluster panel, prod-eu1, 10:41
            </div>
            <KeyValues
              keyWidth={110}
              items={[
                ['Workload', <Mono key="w">payments/Deployment/refund-webhook</Mono>],
                [
                  'Replicas',
                  <State key="r" tone="danger">
                    1 ready of 3
                  </State>,
                ],
                ['Pods', '2 CrashLoopBackOff, 8 and 6 restarts'],
                ['Last ended', <Mono key="l">OOMKilled, exit 137</Mono>],
                ['Limits', <Mono key="m">memory 256Mi</Mono>],
                ['Events', 'BackOff ×31, OOMKilling ×8, ProgressDeadlineExceeded'],
                [
                  'Node',
                  <span key="n">
                    <Mono>prod-eu1-b-2hd8</Mono>, memory 89%
                  </span>,
                ],
                [
                  'Changed',
                  <span key="c">
                    Revision 7, <Mono>refund-webhook:2.14.0</Mono>, 47m ago
                  </span>,
                ],
              ]}
            />
          </div>
          <NextSteps className={s.gateSteps}>
            <NextStep onPress={() => setDrafted(false)}>Discard</NextStep>
            <NextStep arrow>Edit</NextStep>
            <NextStep signal onPress={() => undefined}>
              Start
            </NextStep>
          </NextSteps>
        </article>
      )}
    </div>
  )
}
