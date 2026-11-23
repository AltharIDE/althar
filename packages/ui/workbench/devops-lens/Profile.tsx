import { useState } from 'react'

import { FormRow, Icon, NextStep, NextSteps, Panel, Prose, Select, Switch, Thread, Turn, You } from '../../src'
import { Mono } from './parts'
import s from './devops.module.css'

/*
 * The Ops profile (DEV-283, ADR-110): Althar notices an infrastructure
 * repository and offers the profile; its settings say what an Ops task may
 * reach. The SSH agent yes, key files never, secrets only for the run that
 * names them.
 */

const FOUND = [
  ['terraform/', 'Terraform, 3 workspaces'],
  ['charts/', 'Helm charts'],
  ['inventory/', 'Ansible inventory, 14 hosts'],
  ['deploy/overlays/', 'Kustomize, dev, staging and prod'],
] as const

export function ProfileOffer({ taken: initial = false }: { taken?: boolean }) {
  const [taken, setTaken] = useState(initial)
  return (
    <Thread label="Conversation">
      <You at="2m ago">Add github.com/storefront/infra</You>
      <Turn voice="Coordinator" at="1m ago">
        <Prose>Added infra. It looks like an infrastructure repository:</Prose>
        <article className={s.offer} aria-label="Ops profile">
          <div className={s.gateTop}>
            <span className={s.gateWord} data-tone="signal">
              <Icon name="worker" size={12} />
              Ops profile
            </span>
          </div>
          <ul className={s.found}>
            {FOUND.map(([path, what]) => (
              <li key={path}>
                <Mono>{path}</Mono>
                <span>{what}</span>
              </li>
            ))}
          </ul>
          <p className={s.alertSays}>
            With it, infra’s tasks can reach your clusters and hosts through your SSH agent and kubeconfig, ask for a secret only for the
            run that needs it, and stop for you before anything on prod.
          </p>
          {taken ? (
            <p className={s.gateAfter}>
              <Icon name="check" size={12} /> infra uses the Ops profile. Change it in infra’s settings.
            </p>
          ) : (
            <NextSteps className={s.gateSteps}>
              <NextStep onPress={() => undefined}>Not now</NextStep>
              <NextStep arrow>See what it allows</NextStep>
              <NextStep signal onPress={() => setTaken(true)}>
                Use the Ops profile
              </NextStep>
            </NextSteps>
          )}
        </article>
      </Turn>
    </Thread>
  )
}

type Secrets = 'run' | 'never'
type Gate = 'you' | 'coordinator' | 'runs'

export function ProfileSettings() {
  const [agent, setAgent] = useState(true)
  const [secrets, setSecrets] = useState<Secrets>('run')
  const [gates, setGates] = useState<Record<string, Gate>>({ dev: 'runs', staging: 'coordinator', prod: 'you' })
  const gateOptions = [
    { value: 'runs' as const, label: 'Runs on its own' },
    { value: 'coordinator' as const, label: 'The coordinator decides' },
    { value: 'you' as const, label: 'You approve' },
  ]
  return (
    <Panel kicker="infra · project settings" title="Ops profile" lede="What infra’s tasks may reach, beyond the repository.">
      <div className={s.settings}>
        <h3 className={s.subTitle}>Credentials</h3>
        <FormRow label="Use my SSH agent" note="Tasks sign with your keys through the agent. The keys stay in it.">
          <Switch checked={agent} onChange={setAgent} />
        </FormRow>
        <FormRow
          label="Read private key files"
          note="Your key directory, cloud credential files and kubeconfig tokens stay closed to tasks."
        >
          <span className={s.never}>
            <Icon name="lock" size={12} />
            Never
          </span>
        </FormRow>
        <FormRow
          label="Secrets"
          note="A run asks for the secrets it names, such as VAULT_TOKEN or the storefront-prod AWS profile. They last that run."
        >
          <Select
            label="Secrets"
            value={secrets}
            onChange={setSecrets}
            width={190}
            options={[
              { value: 'run', label: 'Asked for each run' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </FormRow>

        <h3 className={s.subTitle}>Environments</h3>
        {(['dev', 'staging', 'prod'] as const).map((env) => (
          <FormRow
            key={env}
            label={env}
            note={
              env === 'dev'
                ? 'dev-eu1 · inventory/dev'
                : env === 'staging'
                  ? 'staging-eu1 · inventory/staging'
                  : 'prod-eu1 · inventory/prod · bastion-eu1-a, bastion-eu1-b'
            }
          >
            <Select
              label={`Applying on ${env}`}
              value={gates[env] ?? 'you'}
              onChange={(value) => setGates({ ...gates, [env]: value })}
              width={210}
              options={env === 'prod' ? gateOptions.filter((one) => one.value === 'you') : gateOptions}
            />
          </FormRow>
        ))}
      </div>
    </Panel>
  )
}
