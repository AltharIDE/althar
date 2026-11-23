import { useState } from 'react'

import { Button, Icon, KeyValues, Segmented, Table } from '../../src'
import { EVENTS, NEVER, NODES, PODS, READS, WORKLOADS, type Env } from './data'
import { Meter, Mono, Section, State } from './parts'
import s from './devops.module.css'

/*
 * The cluster health panel, in detail (ADR-112): what Althar reads from a
 * cluster with get/list/watch on an allowlist of kinds and fields. Identity,
 * replicas, rollout, pod readiness and restarts, events, node capacity.
 * Nothing from Secrets or ConfigMaps, no environment values, no logs.
 */

export function ClusterPanel({ onInvestigate }: { onInvestigate?: () => void }) {
  const [env, setEnv] = useState<Env>('prod')
  const [open, setOpen] = useState<string | null>('refund-webhook')
  const failing = WORKLOADS.find((one) => one.name === open)
  return (
    <div className={s.cluster}>
      <header className={s.clusterHead}>
        <h1 className={s.pageTitle}>Cluster</h1>
        <Segmented
          label="Environment"
          value={env}
          onChange={setEnv}
          options={[
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'prod', label: 'prod' },
          ]}
        />
        <span className={s.read}>
          <Mono>prod-eu1</Mono> · read 20s ago
        </span>
      </header>

      <Section title="Workloads" aside="1 of 5 unhealthy">
        <Table
          className={s.table}
          head={['Workload', 'Ready', 'Rollout', 'Restarts, 1h', 'Image']}
          align={[null, 'right', null, 'right', null]}
          rows={WORKLOADS.map((one) => [
            <button
              key="n"
              type="button"
              className={s.linkCell}
              onClick={() => setOpen(open === one.name ? null : one.name)}
              aria-expanded={open === one.name}
            >
              <span className={s.ns}>{one.namespace}/</span>
              {one.name}
            </button>,
            <span key="r" className={s.num} data-tone={one.ready < one.desired ? 'danger' : undefined}>
              {one.ready}/{one.desired}
            </span>,
            <State key="o" tone={one.rollout.tone}>
              {one.rollout.says}
            </State>,
            <span key="x" className={s.num} data-tone={one.restarts > 5 ? 'danger' : undefined}>
              {one.restarts}
            </span>,
            <Mono key="i">{one.image}</Mono>,
          ])}
        />
      </Section>

      {failing !== undefined && (
        <section className={s.detail} aria-label={`${failing.kind} ${failing.name}`}>
          <header className={s.detailHead}>
            <h2 className={s.detailTitle}>
              <span className={s.kind}>{failing.kind}</span> {failing.name}
            </h2>
            <State tone={failing.rollout.tone}>{failing.rollout.says}</State>
            <Button size="small" variant="signal" icon="search" onClick={onInvestigate}>
              Investigate
            </Button>
          </header>
          <div className={s.detailGrid}>
            <KeyValues
              keyWidth={86}
              items={[
                ['Namespace', <Mono key="n">{failing.namespace}</Mono>],
                ['Image', <Mono key="i">{failing.image}</Mono>],
                ['Revision', '7, rolled out 47m ago'],
                ['Replicas', `${failing.ready} ready of ${failing.desired}`],
                ['Strategy', 'RollingUpdate, 25% surge'],
                ['Limits', <Mono key="l">memory 256Mi · cpu 500m</Mono>],
              ]}
            />
            <div className={s.events}>
              <h3 className={s.subTitle}>Events</h3>
              <ul className={s.rows}>
                {EVENTS.map((one) => (
                  <li key={one.reason} className={s.eventRow}>
                    <State tone={one.tone}>{one.reason}</State>
                    <span className={s.eventSays}>{one.says}</span>
                    <span className={s.at}>
                      {one.count > 1 ? `×${one.count} · ` : ''}
                      {one.ago}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <h3 className={s.subTitle}>Pods</h3>
          <Table
            className={s.table}
            head={['Pod', 'Node', 'Ready', 'Status', 'Restarts', 'Last ended', 'Age']}
            align={[null, null, 'right', null, 'right', null, 'right']}
            rows={PODS.map((one) => [
              one.name,
              <Mono key="n">{one.node}</Mono>,
              <span key="r" className={s.num}>
                {one.ready}
              </span>,
              <State key="p" tone={one.phase.tone}>
                {one.phase.says}
              </State>,
              <span key="x" className={s.num} data-tone={one.restarts > 0 ? 'danger' : undefined}>
                {one.restarts}
              </span>,
              <span key="l" className={s.quietCell}>
                {one.last ?? '—'}
              </span>,
              <span key="a" className={s.num}>
                {one.age}
              </span>,
            ])}
          />
        </section>
      )}

      <Section title="Nodes" aside="6 of 6 ready">
        <Table
          className={s.table}
          head={['Node', 'Ready', 'CPU requested', 'Memory requested', 'Pods', 'Kubelet']}
          rows={NODES.map((one) => [
            one.name,
            one.pressure === undefined ? (
              <State key="r" tone="ok">
                Ready
              </State>
            ) : (
              <State key="r" tone="warm">
                {one.pressure}
              </State>
            ),
            <Meter key="c" value={one.cpu} />,
            <Meter key="m" value={one.memory} />,
            <span key="p" className={s.num}>
              {one.pods}
            </span>,
            <Mono key="v">{one.version}</Mono>,
          ])}
        />
      </Section>

      <footer className={s.allow}>
        <Icon name="lock" size={12} />
        <span>
          <b>Reads</b> {READS.join(' · ')}
        </span>
        <span>
          <b>Never</b> {NEVER.join(' · ')}
        </span>
      </footer>
    </div>
  )
}
