import { useId, type ReactNode } from 'react'
import { Caret, Code, Disclosure, DisclosureTrigger, Field, Fold, Problem, Segmented } from '@althar/ui'

import { OptionFields } from '../../../src/renderer/features/homes/ConnectHome'
import { type Flow, PAIRING_CODE_MAX_LENGTH } from '../flow'
import s from './parts.module.css'

/* The fields every direction asks for, as the app has them: what changes between directions is round them. */

export function MethodSwitch({ flow, className }: { flow: Flow; className?: string }) {
  return (
    <Segmented
      label="Connection method"
      value={flow.method}
      onChange={flow.setMethod}
      className={className}
      options={[
        { value: 'pair', label: 'Pairing code', disabled: flow.busy },
        { value: 'ssh', label: 'SSH', disabled: flow.busy },
      ]}
    />
  )
}

export function Labelled({ label, htmlFor, children, under }: { label: string; htmlFor: string; children: ReactNode; under?: ReactNode }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {under}
    </div>
  )
}

export function HostField({ flow, focus = true, help }: { flow: Flow; focus?: boolean; help?: ReactNode }) {
  const id = useId()
  const problem = flow.method === 'ssh' ? flow.problem : null
  return (
    <Labelled
      label="SSH host"
      htmlFor={id}
      under={problem !== null ? <Problem size="small">{problem}</Problem> : help !== undefined ? <p className={s.help}>{help}</p> : null}
    >
      <Field
        id={id}
        value={flow.ssh.target}
        invalid={problem !== null}
        readOnly={flow.stage === 'connecting'}
        placeholder="user@host, or a Host from your SSH config"
        spellCheck={false}
        autoComplete="off"
        className={s.mono}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- lab
        autoFocus={focus}
        onChange={(event) => flow.ssh.setTarget(event.currentTarget.value)}
      />
    </Labelled>
  )
}

export function Options({ flow }: { flow: Flow }) {
  return (
    <Disclosure>
      <DisclosureTrigger>
        <button type="button" className={s.more}>
          Connection options <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <OptionFields form={flow.ssh} />
      </Fold>
    </Disclosure>
  )
}

export function CodeField({ flow, focus = true, help = true }: { flow: Flow; focus?: boolean; help?: boolean | ReactNode }) {
  const id = useId()
  const problem = flow.method === 'pair' && flow.pair.info === null ? flow.pair.problem : null
  return (
    <Labelled
      label="Pairing code"
      htmlFor={id}
      under={
        problem !== null ? (
          <Problem size="small">{problem}</Problem>
        ) : help === true ? (
          <p className={s.help}>
            On the host, run <Code>althar-host pair</Code> to create a code.
          </p>
        ) : help === false ? null : (
          <p className={s.help}>{help}</p>
        )
      }
    >
      <Field
        id={id}
        type="password"
        value={flow.pair.code}
        maxLength={PAIRING_CODE_MAX_LENGTH}
        disabled={flow.pair.pending}
        invalid={problem !== null}
        autoComplete="off"
        spellCheck={false}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- lab
        autoFocus={focus}
        onChange={(event) => flow.pair.setCode(event.currentTarget.value)}
      />
    </Labelled>
  )
}

export function NameField({ flow, size, focus = false }: { flow: Flow; size?: 'large'; focus?: boolean }) {
  const id = useId()
  return (
    <Labelled label="Name" htmlFor={id}>
      <Field
        id={id}
        size={size}
        value={flow.name}
        maxLength={120}
        disabled={flow.stage === 'connecting' || flow.stage === 'connected'}
        autoComplete="off"
        placeholder="My server"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- lab
        autoFocus={focus}
        onChange={(event) => flow.setName(event.currentTarget.value)}
      />
    </Labelled>
  )
}

/** A problem with what was found or connecting to it, where no field has it. */
export function LaterProblem({ flow }: { flow: Flow }) {
  if (flow.method === 'pair' && flow.pair.info !== null && flow.pair.problem !== null)
    return <Problem size="small">{flow.pair.problem}</Problem>
  return null
}

/** An identity in groups of four, for comparing by eye with what the host prints. */
export function Chunked({ homeId, className }: { homeId: string; className?: string }) {
  const [kind, rest = ''] = homeId.split('_')
  const groups = rest.match(/.{1,4}/g) ?? []
  return (
    <code className={className} aria-label={homeId} title={homeId}>
      <span aria-hidden="true">
        <span className={s.kind}>{kind}_</span>
        {groups.map((group, at) => (
          <span key={at} className={s.group}>
            {group}
          </span>
        ))}
      </span>
    </code>
  )
}
