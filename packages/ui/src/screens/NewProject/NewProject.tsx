import { useId, useRef, useState, type ReactNode } from 'react'

import { PermissionPolicy } from '../../foundations/vocabulary'
import { permissionPolicyText, type ChoiceWords } from '../../foundations/vocabularyText'
import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
import { Field, FieldError } from '../../primitives/Field/Field'
import { FormRow } from '../../primitives/FormRow/FormRow'
import { Panel } from '../../primitives/Panel/Panel'
import { SourceMap, type SourceMapProps } from '../../setup/SourceMap/SourceMap'
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
  name: { label: string; note: string; placeholder: string; empty: string }
  sources: { label: string; note: string }
  asks: { label: string; note: string }
  permission: Record<PermissionPolicy, ChoiceWords>
  foot: string
  create: string
  cancel: string
}

export const newProjectText: NewProjectText = {
  kicker: 'New project',
  title: 'What is the work?',
  lede: 'A project holds a body of work: the repositories its tasks may change, what those tasks learn, and how often agents ask you.',
  name: {
    label: 'Name',
    note: 'The outcome or body of work. You can rename it later.',
    placeholder: 'Refunds v2',
    empty: 'Name the work first',
  },
  sources: { label: 'Repositories', note: 'The ones its tasks may change. A project can have none.' },
  asks: { label: 'When agents need a yes', note: 'The rest of the project rules have defaults; change them any time.' },
  permission: permissionPolicyText,
  foot: 'Althar reads these folders and changes nothing in them. Tasks work in their own worktrees.',
  create: 'Create project',
  cancel: 'Cancel',
}

const PERMISSIONS = [PermissionPolicy.Coordinator, PermissionPolicy.AllowAll, PermissionPolicy.Ask] as const

export interface NewProjectProps extends Omit<SourceMapProps, 'className' | 'text'> {
  /** Why the form is showing, when a repository was opened and reading it found something to decide. */
  because?: string
  name?: string
  defaultName?: string
  onNameChange?: (name: string) => void
  permissions?: PermissionPolicy
  defaultPermissions?: PermissionPolicy
  onPermissionsChange?: (value: PermissionPolicy) => void
  /** The choices offered, where a consumer offers fewer: only what it does. */
  permissionOptions?: readonly PermissionPolicy[]
  onCreate: (project: { name: string; permissions: PermissionPolicy }) => void
  onCancel: () => void
  /** Making it is under way: Create shows it and ignores presses. */
  creating?: boolean
  /** Why the last try did not go through, said in the foot. */
  error?: ReactNode
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
  defaultPermissions = PermissionPolicy.Coordinator,
  onPermissionsChange,
  permissionOptions = PERMISSIONS,
  onCreate,
  onCancel,
  creating = false,
  error,
  className,
  text,
  ...map
}: NewProjectProps) {
  const t = { ...newProjectText, ...text }
  const nameId = useId()
  const [name, setName] = useControlled(nameProp, defaultName, onNameChange)
  const [permissions, setPermissions] = useControlled(permissionsProp, defaultPermissions, onPermissionsChange)
  const reading = map.sources.some((x) => x.reading)
  const [unnamed, setUnnamed] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const unnamedId = useId()

  return (
    <Panel
      as="form"
      kicker={t.kicker}
      title={t.title}
      lede={because ?? t.lede}
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        /* while a repository is still being read, Create shows it is waiting and ignores presses */
        if (reading || creating) return
        if (!name.trim()) {
          setUnnamed(true)
          nameField.current?.focus()
          return
        }
        onCreate({ name: name.trim(), permissions })
      }}
      foot={
        <>
          <span className={s.promise}>{t.foot}</span>
          <Button variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={reading || creating}>
            {t.create}
          </Button>
          {error && (
            <span className={s.error} role="alert">
              {error}
            </span>
          )}
        </>
      }
    >
      <FormRow label={t.name.label} note={t.name.note} htmlFor={nameId}>
        <Field
          ref={nameField}
          id={nameId}
          size="large"
          className={s.name}
          value={name}
          placeholder={t.name.placeholder}
          invalid={unnamed}
          aria-describedby={unnamed ? unnamedId : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setUnnamed(false)
          }}
        />
        {unnamed && <FieldError id={unnamedId}>{t.name.empty}</FieldError>}
      </FormRow>

      <FormRow label={t.sources.label} note={t.sources.note}>
        <SourceMap {...map} />
      </FormRow>

      <FormRow label={t.asks.label} note={t.asks.note}>
        <Choices
          options={permissionOptions.map((value) => ({ value, ...t.permission[value] }))}
          value={permissions}
          onChange={setPermissions}
        />
      </FormRow>
    </Panel>
  )
}
