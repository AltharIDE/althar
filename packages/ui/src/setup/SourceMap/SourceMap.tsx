import { useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { SourceOrigin } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { useRefocus } from '../../lib/refocus'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Select, type SelectOption } from '../../primitives/Select/Select'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './SourceMap.module.css'

/*
 * The repositories a project will work in, as Charrette read them before
 * anything is made: where each one is, its branch and remote, the role it
 * plays, and anything found that is worth a word. Reading changes nothing
 * in the folder. A finding that needs a decision comes with one already
 * made, so the map can be confirmed as it stands. Sources are added one by
 * one; Charrette never goes looking for more.
 */

export interface SourceFinding {
  id: string
  /** What was found, as a sentence. */
  text: string
  /** The decision it needs, with a sensible answer already chosen. */
  choice?: { label: string; options: readonly SelectOption<string>[]; value: string }
}

export interface SourceEntry {
  id: string
  /** The repository's name. */
  name: string
  /** The folder on this device, or the URL it clones from. */
  where: string
  origin: SourceOrigin
  /** Still being read. */
  reading?: boolean
  branch?: string
  /** Its remote. Without one, it exists only here. */
  remote?: string
  /** For one not on this device: where cloning would put it, as the consumer decides it: ~/Charrette/meridian-web. */
  cloneTo?: string
  /** What it is to this project: frontend, service. Suggested from what was read. */
  role: string
  findings?: readonly SourceFinding[]
}

export interface SourceMapText {
  label: string
  reading: string
  noRemote: string
  origin: string
  clone: string
  later: string
  laterNote: string
  role: (name: string) => string
  remove: (name: string) => string
  empty: string
  folders: string
  url: string
  urlField: string
  /** An example address, in the empty field. */
  urlPlaceholder: string
  /** Said when Add is pressed with no address. */
  urlEmpty: string
  urlAdd: string
  urlCancel: string
}

export const sourceMapText: SourceMapText = {
  label: 'Sources',
  reading: 'Reading it. Nothing in the folder is changed',
  noRemote: 'no remote',
  origin: 'On this Mac',
  clone: 'Clone it here',
  later: 'Map it later',
  laterNote: 'Tasks that need it wait until it is on this Mac',
  role: (name) => `Role of ${name}`,
  remove: (name) => `Remove ${name}`,
  empty: 'No repositories. The project can plan, research and write; add one when it needs code.',
  folders: 'Choose folders',
  url: 'Clone from a URL',
  urlField: 'Repository URL',
  urlPlaceholder: 'github.com/owner/repository',
  urlEmpty: 'Paste the repository’s address first',
  urlAdd: 'Add',
  urlCancel: 'Cancel',
}

export interface SourceMapProps {
  sources: readonly SourceEntry[]
  /** The roles a source can play. */
  roles: readonly SelectOption<string>[]
  onRoleChange: (id: string, role: string) => void
  /** For a source that is not on this device: clone it here, or map it later. */
  onOriginChange: (id: string, origin: SourceOrigin) => void
  onFindingChange: (id: string, finding: string, value: string) => void
  onRemove: (id: string) => void
  /** Opens the system's folder picker. Without it, no such button. */
  onChooseFolders?: () => void
  /** Adds a repository by its URL. Without it, no such button. */
  onAddUrl?: (url: string) => void
  className?: string
  text?: Partial<SourceMapText>
}

/** A project's sources before it is made: each repository's place, branch, remote and role, and what reading it found. */
export function SourceMap({
  sources,
  roles,
  onRoleChange,
  onOriginChange,
  onFindingChange,
  onRemove,
  onChooseFolders,
  onAddUrl,
  className,
  text,
}: SourceMapProps) {
  const t = { ...sourceMapText, ...text }
  return (
    <div className={cx(s.map, className)}>
      {sources.length ? (
        <ul aria-label={t.label} className={s.list}>
          {sources.map((x) => (
            <Source
              key={x.id}
              x={x}
              t={t}
              roles={roles}
              onRoleChange={onRoleChange}
              onOriginChange={onOriginChange}
              onFindingChange={onFindingChange}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : (
        <p className={s.empty}>{t.empty}</p>
      )}
      <Add t={t} onChooseFolders={onChooseFolders} onAddUrl={onAddUrl} />
    </div>
  )
}

interface SourceProps extends Pick<SourceMapProps, 'roles' | 'onRoleChange' | 'onOriginChange' | 'onFindingChange' | 'onRemove'> {
  x: SourceEntry
  t: SourceMapText
}

function Source({ x, t, roles, onRoleChange, onOriginChange, onFindingChange, onRemove }: SourceProps) {
  const here = x.origin === SourceOrigin.Existing
  return (
    <li className={s.source}>
      <Icon name={here ? 'folder' : 'globe'} size={14} className={s.icon} />
      <span className={s.head}>
        <span className={s.name}>{x.name}</span>
        <span className={s.where}>{x.where}</span>
      </span>
      <span className={s.end}>
        {!x.reading && <Select label={t.role(x.name)} options={roles} value={x.role} onChange={(v) => onRoleChange(x.id, v)} />}
        <IconButton icon="close" size="small" label={t.remove(x.name)} onClick={() => onRemove(x.id)} />
      </span>

      <span className={s.facts}>
        {x.reading ? (
          <span className={s.fact}>
            <Spinner size="small" />
            {t.reading}
          </span>
        ) : (
          <>
            {(x.branch || here) && (
              <span className={s.fact}>
                {x.branch && (
                  <span className={s.branch}>
                    <Icon name="branch" size={11} />
                    {x.branch}
                  </span>
                )}
                {here && <span>{x.remote ?? t.noRemote}</span>}
              </span>
            )}
            {!here && (
              <span className={s.fact}>
                <Select
                  label={`${t.origin}: ${x.name}`}
                  options={[
                    { value: SourceOrigin.Clone, label: x.cloneTo ? `${t.clone} · ${x.cloneTo}` : t.clone },
                    { value: SourceOrigin.Later, label: t.later },
                  ]}
                  value={x.origin}
                  onChange={(v) => onOriginChange(x.id, v)}
                />
                {x.origin === SourceOrigin.Later && <span>{t.laterNote}</span>}
              </span>
            )}
            {x.findings?.map((f) => (
              <span key={f.id} className={s.finding}>
                <span>{f.text}</span>
                {f.choice && (
                  <Select
                    label={f.choice.label}
                    options={f.choice.options}
                    value={f.choice.value}
                    onChange={(v) => onFindingChange(x.id, f.id, v)}
                  />
                )}
              </span>
            ))}
          </>
        )}
      </span>
    </li>
  )
}

/* Adding: folders from the system's picker, or one URL typed in place. */
function Add({ t, onChooseFolders, onAddUrl }: Pick<SourceMapProps, 'onChooseFolders' | 'onAddUrl'> & { t: SourceMapText }) {
  const [typing, setTyping] = useState(false)
  const [url, setUrl] = useState('')
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const field = useRef<HTMLInputElement>(null)
  const back = useRefocus<HTMLButtonElement>(typing)
  useEffect(() => {
    if (typing) field.current?.focus()
  }, [typing])
  if (!onChooseFolders && !onAddUrl) return null
  const close = () => {
    setTyping(false)
    setUrl('')
    setEmpty(false)
  }
  const add = () => {
    if (!onAddUrl) return
    if (!url.trim()) {
      setEmpty(true)
      field.current?.focus()
      return
    }
    onAddUrl(url.trim())
    close()
  }
  /* Not a form of its own: it is often inside one. */
  if (typing && onAddUrl)
    return (
      <fieldset aria-label={t.url} className={s.url}>
        <Field
          ref={field}
          className={s.urlField}
          aria-label={t.urlField}
          placeholder={t.urlPlaceholder}
          value={url}
          invalid={empty}
          aria-describedby={empty ? errorId : undefined}
          onChange={(e) => {
            setUrl(e.target.value)
            setEmpty(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            close()
          }}
        />
        <Button variant="quiet" onClick={close}>
          {t.urlCancel}
        </Button>
        <Button onClick={add}>{t.urlAdd}</Button>
        {empty && <FieldError id={errorId}>{t.urlEmpty}</FieldError>}
      </fieldset>
    )
  return (
    <div className={s.add}>
      {onChooseFolders && (
        <ActionButton icon="folder" onClick={onChooseFolders}>
          {t.folders}
        </ActionButton>
      )}
      {onAddUrl && (
        <ActionButton ref={back} icon="globe" onClick={() => setTyping(true)}>
          {t.url}
        </ActionButton>
      )}
    </div>
  )
}
