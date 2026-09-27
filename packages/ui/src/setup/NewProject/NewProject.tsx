import { useId } from 'react'

import { PermissionPolicy } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
import { Field } from '../../primitives/Field/Field'
import { FormRow } from '../../primitives/FormRow/FormRow'
import { Panel } from '../../primitives/Panel/Panel'
import { SourceMap, type SourceMapProps } from '../SourceMap/SourceMap'
import s from './NewProject.module.css'

/*
 * Making a project on purpose: a name for the work, the repositories it
 * works in (or none), and the one rule worth deciding before any agent
 * starts. Everything else has a default and lives in the project's rules.
 * Opening a single repository skips this form unless reading it found
 * something to decide; it makes the same kind of project.
 */

export interface NewProjectText {
  kicker: string
  title: string
  lede: string
  name: { label: string; note: string; placeholder: string }
  sources: { label: string; note: string }
  asks: { label: string; note: string }
  permission: Record<PermissionPolicy, { title: string; note: string }>
  foot: string
  create: string
  cancel: string
}

export const newProjectText: NewProjectText = {
  kicker: 'New project',
  title: 'What is the work?',
  lede: 'A project holds a body of work: the repositories its tasks may change, what those tasks learn, and how often agents ask you.',
  name: { label: 'Name', note: 'The outcome or body of work. You can rename it later.', placeholder: 'Refunds v2' },
  sources: { label: 'Repositories', note: 'The ones its tasks may change. A project can have none.' },
  asks: { label: 'When agents need a yes', note: 'The rest of the project rules have defaults; change them any time.' },
  permission: {
    [PermissionPolicy.Lead]: {
      title: 'The agent in charge decides',
      note: 'Each task has one agent in charge of it, its lead. It allows what the task needs and asks you about the rest.',
    },
    [PermissionPolicy.AllowAll]: { title: 'Allow everything', note: 'Nothing asks. Every request is still recorded on its task.' },
    [PermissionPolicy.Ask]: { title: 'Ask me', note: 'Anything no rule covers waits for you.' },
  },
  foot: 'Charrette reads these folders and changes nothing in them. Tasks work in their own worktrees.',
  create: 'Create project',
  cancel: 'Cancel',
}

const PERMISSIONS = [PermissionPolicy.Lead, PermissionPolicy.AllowAll, PermissionPolicy.Ask] as const

export interface NewProjectProps extends Omit<SourceMapProps, 'className' | 'text'> {
  /** Why the form is showing, when a repository was opened and reading it found something to decide. */
  because?: string
  name?: string
  defaultName?: string
  onNameChange?: (name: string) => void
  permissions?: PermissionPolicy
  defaultPermissions?: PermissionPolicy
  onPermissionsChange?: (value: PermissionPolicy) => void
  onCreate: (project: { name: string; permissions: PermissionPolicy }) => void
  onCancel: () => void
  className?: string
  text?: Partial<NewProjectText>
}

/** A new project: its name, its repositories as read, and who answers when agents need a yes. */
export function NewProject({
  because,
  name: nameProp,
  defaultName = '',
  onNameChange,
  permissions: permissionsProp,
  defaultPermissions = PermissionPolicy.Lead,
  onPermissionsChange,
  onCreate,
  onCancel,
  className,
  text,
  ...map
}: NewProjectProps) {
  const t = { ...newProjectText, ...text }
  const nameId = useId()
  const [name, setName] = useControlled(nameProp, defaultName, onNameChange)
  const [permissions, setPermissions] = useControlled(permissionsProp, defaultPermissions, onPermissionsChange)
  const reading = map.sources.some((x) => x.reading)
  const ready = name.trim() !== '' && !reading

  return (
    <Panel
      as="form"
      kicker={t.kicker}
      title={t.title}
      lede={because ?? t.lede}
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onCreate({ name: name.trim(), permissions })
      }}
      foot={
        <>
          <span className={s.promise}>{t.foot}</span>
          <Button variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button type="submit" disabled={!ready}>
            {t.create}
          </Button>
        </>
      }
    >
      <FormRow label={t.name.label} note={t.name.note} htmlFor={nameId}>
        <Field
          id={nameId}
          size="large"
          className={s.name}
          value={name}
          placeholder={t.name.placeholder}
          onChange={(e) => setName(e.target.value)}
        />
      </FormRow>

      <FormRow label={t.sources.label} note={t.sources.note}>
        <SourceMap {...map} />
      </FormRow>

      <FormRow label={t.asks.label} note={t.asks.note}>
        <Choices
          label={t.asks.label}
          options={PERMISSIONS.map((value) => ({ value, ...t.permission[value] }))}
          value={permissions}
          onChange={setPermissions}
        />
      </FormRow>
    </Panel>
  )
}
