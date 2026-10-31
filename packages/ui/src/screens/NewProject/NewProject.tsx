import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { commandDown, keys, modKey } from '../../foundations/keys'
import { device } from '../../foundations/device'
import type { CodeHost } from '../../foundations/codeHost'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { unreachable } from '../../foundations/vocabulary'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { InkSwatches, type InkSwatchesText } from '../../primitives/InkSwatches/InkSwatches'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './NewProject.module.css'

/*
 * A project before it is made, in a tab of its own, as a browser opens a new
 * tab. The page is the project as it takes shape: on the left its mark,
 * large, in a wash of its colour, its name in the size of a title, its
 * colour and what it is made of; on the right its folders. The name comes
 * first, and leads the folders: what is on this computer named like it is
 * one press away. Each folder is shown as it was read, as a repository with
 * where it is and where its code is hosted, and what reading them found is
 * said under them. Folders come from the system's picker, several at once,
 * or dropped anywhere on the page.
 */

/** A folder added, as it was read: its repository, where it is, and where its remote is. */
export type NewProjectFolder =
  | {
      readonly id: string
      /** Still being read: its name, where it is known already. */
      readonly reading: true
      readonly name?: string
    }
  | {
      readonly id: string
      readonly reading?: false
      readonly name: string
      /** Where it is, as the person knows the place: ~/code/northwind/app. */
      readonly where: string
      /** Where its code is hosted; null without a remote, or one on no host Althar knows. */
      readonly host: CodeHost | null
      /** Its remote, as its host names it: northwind-co/app; null without one. */
      readonly remote: string | null
    }

/** A repository on this computer that could be added in one press. */
export interface NewProjectSuggestion {
  readonly id: string
  readonly name: string
  readonly where: string
  /** The project it is in already, by name: said in place of Add. */
  readonly in?: string
}

/** The repositories offered: those named like the project first, when there are any, and the rest behind a link. */
export interface NewProjectFound {
  /** The project's name, when `first` are those named like it. */
  readonly like: string | null
  readonly first: readonly NewProjectSuggestion[]
  readonly more: readonly NewProjectSuggestion[]
}

/** Something reading the folders found beyond each one. */
export type NewProjectFinding =
  | {
      readonly id: string
      /** Their code is on a host Althar is connected to. */
      readonly kind: 'connected'
      readonly host: CodeHost
      /** Whose repositories they are there: northwind-co. */
      readonly owners: readonly string[]
      readonly account: string
    }
  | {
      readonly id: string
      /** One is on a host Althar isn't connected to. */
      readonly kind: 'unconnected'
      readonly host: CodeHost
      readonly remote: string
      /** What its tasks would open there, connected: pull requests, merge requests. */
      readonly changes: string
    }
  | {
      readonly id: string
      /** One is in another project already. */
      readonly kind: 'shared'
      readonly name: string
      readonly project: string
    }

export interface NewProjectText {
  label: string
  name: string
  namePlaceholder: string
  nameNote: string
  colour: string
  madeOf: string
  folders: string
  noRemote: string
  leaveOut: (name: string) => string
  choose: string
  chooseNote: string
  found: string
  foundLike: (name: string) => string
  add: string
  addLabel: (name: string) => string
  inProject: (project: string) => string
  more: (count: number) => string
  read: string
  connected: (host: string, owners: ReactNode, account: string) => ReactNode
  unconnected: (remote: ReactNode, host: string, changes: string) => ReactNode
  connect: (host: string) => string
  shared: (name: ReactNode, project: string) => ReactNode
  create: (name: string) => string
  createUnnamed: string
  createKbd: string
  /** Said when Create is pressed without a name, or without a folder. */
  needsName: string
  needsFolder: string
  swatches: Partial<InkSwatchesText>
}

export const newProjectText: NewProjectText = {
  label: 'New project',
  name: 'Name',
  namePlaceholder: 'Name the project',
  nameNote: 'You can rename it later.',
  colour: 'Colour',
  madeOf: 'Made of',
  folders: 'Its folders',
  noRemote: 'no remote',
  leaveOut: (name) => `Leave out ${name}`,
  choose: 'Choose a folder…',
  chooseNote: 'or drop them here',
  found: `On ${device.this}`,
  foundLike: (name) => `On ${device.this}, named like ${name}`,
  add: 'Add',
  addLabel: (name) => `Add ${name}`,
  inProject: (project) => `in ${project}`,
  more: (count) => `${count} more on ${device.this}`,
  read: 'What Althar read',
  connected: (host, owners, account) => (
    <>
      Code on {host}, {owners}. Connected as {account}.
    </>
  ),
  unconnected: (remote, host, changes) => (
    <>
      {remote} is on {host}, which isn’t connected. Its tasks push their branch; connected, they open {changes}.
    </>
  ),
  connect: (host) => `Connect ${host}`,
  shared: (name, project) => (
    <>
      {name} is in {project} too. Each project’s tasks work on it in worktrees of their own.
    </>
  ),
  create: (name) => `Create ${name}`,
  createUnnamed: 'Create project',
  createKbd: modKey(keys.enter),
  needsName: 'Name the project first.',
  needsFolder: 'Add a folder first.',
  swatches: {},
}

export type NewProjectProps = RootProps<
  'div',
  {
    /** What its mark is drawn from: the id it will have, so the mark shown is the mark it gets. */
    seed: string
    name: string
    onNameChange: (name: string) => void
    ink: ProjectInk
    onInkChange: (ink: ProjectInk) => void
    /** Which other project has each ink, by its name. */
    taken?: Partial<Record<ProjectInk, string>>
    folders: readonly NewProjectFolder[]
    onRemove: (id: string) => void
    /** Opens the system's folder picker. */
    onChoose: () => void
    /** Folders dropped on the page. Without it, a drop does nothing. */
    onDrop?: (files: readonly File[]) => void
    /** What is on this computer to add; null while it is still being looked for. */
    found: NewProjectFound | null
    onAdd: (id: string) => void
    findings?: readonly NewProjectFinding[]
    /** Connects the host a finding names. Without it, no way to from here. */
    onConnect?: (id: string) => void
    /** Makes the project: pressed with a name and a folder, once every folder is read. */
    onCreate: () => void
    /** Escape: nothing is made. */
    onCancel: () => void
    /** Making it is under way: Create shows it and ignores presses. */
    creating?: boolean
    /** Why the last try didn't go through, said in the foot. */
    error?: ReactNode
    text?: Partial<NewProjectText>
  }
>

/** What is missing when Create is pressed. */
type Missing = 'name' | 'folder' | null

/** A list whose row went with the button focus was on: focus goes to the same place in it. */
type Refocus = { readonly list: 'folders' | 'found'; readonly at: number }

/** Something is open over the page, positioned by Radix or a dialog, which Escape closes first. */
const overlaid = () => document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]') !== null

/** A project being made in its own tab: its name, mark and colour, and its folders as they are read. */
export function NewProject({
  seed,
  name,
  onNameChange,
  ink,
  onInkChange,
  taken,
  folders,
  onRemove,
  onChoose,
  onDrop,
  found,
  onAdd,
  findings = [],
  onConnect,
  onCreate,
  onCancel,
  creating = false,
  error,
  className,
  text,
  onKeyDown,
  ...rest
}: NewProjectProps) {
  const t = { ...newProjectText, ...text }
  const ids = { title: useId(), name: useId(), note: useId(), missing: useId(), folders: useId() }
  const nameField = useRef<HTMLInputElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const [missing, setMissing] = useState<Missing>(null)
  const refocus = useRef<Refocus | null>(null)
  const side = useRef<HTMLDivElement>(null)
  const { over, handlers } = useDragOver(onDrop)
  const named = name.trim()
  const read = folders.flatMap((folder) => (folder.reading === true ? [] : [folder]))
  const reading = read.length < folders.length

  const create = () => {
    if (creating || reading) return
    if (named === '') {
      setMissing('name')
      nameField.current?.focus()
      return
    }
    if (read.length === 0) {
      setMissing('folder')
      chooseButton.current?.focus()
      return
    }
    setMissing(null)
    onCreate()
  }

  // The tab opens to be named.
  useEffect(() => nameField.current?.focus(), [])

  // A row added or left out takes its button with it: focus goes to the button now in its place, else to Choose a folder.
  useEffect(() => {
    const was = refocus.current
    if (was === null) return
    refocus.current = null
    if (document.activeElement !== null && document.activeElement !== document.body) return
    const buttons = side.current?.querySelectorAll<HTMLButtonElement>(`[data-refocus="${was.list}"]`) ?? []
    ;(buttons[Math.min(was.at, buttons.length - 1)] ?? chooseButton.current)?.focus()
  })

  // Escape makes nothing, and ⌘↵ makes it, from anywhere on the page; what is open over it, a tooltip too, hears Escape first.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      // Once it is being made, there is nothing to leave.
      if (creating || overlaid() || (event.target instanceof Element && event.target.closest('[data-own-escape]') !== null)) return
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && commandDown(event)) {
      event.preventDefault()
      create()
    }
  }

  return (
    <div
      {...rest}
      className={cx(s.page, over && s.over, className)}
      style={cssVars({ '--ink': `var(--project-${ink})` })}
      onKeyDown={keys}
      {...handlers}
    >
      <section className={s.who} aria-labelledby={ids.title}>
        <div className={s.whoInner}>
          <VisuallyHidden>
            <h1 id={ids.title}>{t.label}</h1>
          </VisuallyHidden>
          {named === '' ? (
            <span className={s.blank} aria-hidden="true" />
          ) : (
            <ProjectMark seed={seed} ink={ink} size={112} className={s.mark} />
          )}
          <label className={s.label} htmlFor={ids.name}>
            {t.name}
          </label>
          <input
            ref={nameField}
            id={ids.name}
            className={s.name}
            value={name}
            placeholder={t.namePlaceholder}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={missing === 'name' || undefined}
            aria-describedby={missing === 'name' ? `${ids.missing} ${ids.note}` : ids.note}
            onChange={(event) => {
              onNameChange(event.target.value)
              if (missing === 'name') setMissing(null)
            }}
          />
          {missing === 'name' && (
            <p id={ids.missing} className={s.missing} role="alert">
              {t.needsName}
            </p>
          )}
          <p id={ids.note} className={s.note}>
            {t.nameNote}
          </p>
          <span className={cx(s.label, s.gap)}>{t.colour}</span>
          <InkSwatches
            value={ink}
            onChange={onInkChange}
            {...(taken === undefined ? {} : { taken })}
            text={{ label: t.colour, ...t.swatches }}
          />
          {read.length > 0 && (
            <>
              <span className={cx(s.label, s.gap)}>{t.madeOf}</span>
              <p className={s.made}>
                {read.map((folder) => (
                  <span key={folder.id} className={s.repo}>
                    <HostMark host={folder.host} size={12} />
                    {folder.name}
                  </span>
                ))}
              </p>
            </>
          )}
        </div>
      </section>

      <section className={s.side} aria-labelledby={ids.folders}>
        <div className={s.sideInner} ref={side}>
          <h2 id={ids.folders} className={s.title}>
            {t.folders}
          </h2>
          {over && <div className={s.empty} aria-hidden="true" />}
          {folders.length > 0 && (
            <ul className={s.folders} aria-label={t.folders}>
              {folders.map((folder, at) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  t={t}
                  onRemove={(id) => {
                    refocus.current = { list: 'folders', at }
                    onRemove(id)
                  }}
                />
              ))}
            </ul>
          )}
          <div className={s.chooseRow}>
            <Button
              ref={chooseButton}
              size="small"
              icon="folder"
              onClick={onChoose}
              aria-describedby={missing === 'folder' ? ids.missing : undefined}
            >
              {t.choose}
            </Button>
            {missing === 'folder' ? (
              <span id={ids.missing} className={s.missing} role="alert">
                {t.needsFolder}
              </span>
            ) : (
              <span className={s.note}>{t.chooseNote}</span>
            )}
          </div>
          {(findings.length > 0 || (found !== null && found.first.length + found.more.length > 0)) && (
            <div className={s.below}>
              {findings.length > 0 && <Findings findings={findings} t={t} {...(onConnect === undefined ? {} : { onConnect })} />}
              {found !== null && (
                <Found
                  found={found}
                  t={t}
                  onAdd={(id, at) => {
                    refocus.current = { list: 'found', at }
                    onAdd(id)
                  }}
                />
              )}
            </div>
          )}
        </div>
        <footer className={s.foot}>
          {error !== undefined && error !== null && (
            <span className={s.error} role="alert">
              {error}
            </span>
          )}
          <Button kbd={t.createKbd} variant={read.length === 0 ? 'quiet' : 'default'} busy={creating || reading} onClick={create}>
            {named === '' ? t.createUnnamed : t.create(named)}
          </Button>
        </footer>
      </section>
    </div>
  )
}

/** A host's mark, a folder for a host Althar has none for, and a dashed tile without one. */
function HostMark({ host, size }: { host: CodeHost | null; size: number }) {
  if (host === null) return <span className={s.noHost} style={{ width: size - 2, height: size - 2 }} aria-hidden="true" />
  return host.brand === undefined ? <Icon name="folder" size={size} /> : <BrandMark brand={host.brand} size={size} />
}

/** A folder as it was read: its repository's name, then where it is, its branch, and where its remote is. */
function FolderRow({ folder, t, onRemove }: { folder: NewProjectFolder; t: NewProjectText; onRemove: (id: string) => void }) {
  if (folder.reading === true)
    return (
      <li className={s.folder} aria-busy="true">
        <span className={s.folderIcon}>
          <Spinner size="small" />
        </span>
        <span className={s.folderMain}>{folder.name !== undefined && <span className={s.folderName}>{folder.name}</span>}</span>
      </li>
    )
  return (
    <li className={s.folder}>
      <span className={s.folderIcon}>
        {folder.host?.brand === undefined ? <Icon name="folder" size={14} /> : <BrandMark brand={folder.host.brand} size={14} />}
      </span>
      <span className={s.folderMain}>
        <span className={s.folderName}>{folder.name}</span>
        <span className={s.facts}>
          <span className={s.mono}>{folder.where}</span>
          {folder.host !== null && folder.remote !== null ? (
            <span className={s.fact}>
              {folder.host.name} · <span className={s.mono}>{folder.remote}</span>
            </span>
          ) : (
            <span className={s.fact}>{t.noRemote}</span>
          )}
        </span>
      </span>
      <IconButton icon="close" size="small" label={t.leaveOut(folder.name)} data-refocus="folders" onClick={() => onRemove(folder.id)} />
    </li>
  )
}

/** What reading the folders found beyond each one: where their code is hosted, as whom, and any in another project. */
function Findings({
  findings,
  t,
  onConnect,
}: {
  findings: readonly NewProjectFinding[]
  t: NewProjectText
  onConnect?: (id: string) => void
}) {
  const titleId = useId()
  return (
    <section className={s.findings} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.sub}>
        {t.read}
      </h3>
      <ul className={s.findingRows}>
        {findings.map((finding) => (
          <li key={finding.id} className={s.finding}>
            <FindingMark finding={finding} />
            <span>{findingWords(finding, t)}</span>
            {finding.kind === 'unconnected' && onConnect !== undefined && (
              <LinkButton onClick={() => onConnect(finding.id)}>{t.connect(finding.host.name)}</LinkButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function FindingMark({ finding }: { finding: NewProjectFinding }) {
  switch (finding.kind) {
    case 'connected':
    case 'unconnected':
      return finding.host.brand === undefined ? <Icon name="globe" size={13} /> : <BrandMark brand={finding.host.brand} size={13} />
    case 'shared':
      return <Icon name="folder" size={13} />
    default:
      return unreachable(finding)
  }
}

const findingWords = (finding: NewProjectFinding, t: NewProjectText): ReactNode => {
  switch (finding.kind) {
    case 'connected':
      return t.connected(
        finding.host.name,
        finding.owners.map((owner, i) => (
          <span key={owner}>
            {i > 0 && ', '}
            <code className={s.code}>{owner}</code>
          </span>
        )),
        finding.account,
      )
    case 'unconnected':
      return t.unconnected(<code className={s.code}>{finding.remote}</code>, finding.host.name, finding.changes)
    case 'shared':
      return t.shared(finding.name, finding.project)
    default:
      return unreachable(finding)
  }
}

/** The repositories on this computer, those named like the project first; each added in one press. */
function Found({ found, t, onAdd }: { found: NewProjectFound; t: NewProjectText; onAdd: (id: string, at: number) => void }) {
  const titleId = useId()
  const [all, setAll] = useState(false)
  const shown = all ? [...found.first, ...found.more] : found.first
  if (shown.length === 0 && found.more.length === 0) return null
  return (
    <section className={s.found} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.sub}>
        {found.like === null ? t.found : t.foundLike(found.like)}
      </h3>
      <ul className={s.foundRows}>
        {shown.map((suggestion, row) => (
          <li key={suggestion.id} className={s.foundRow}>
            <span className={s.foundMain}>
              <span className={s.foundName}>{suggestion.name}</span>
              <span className={s.facts}>
                <span className={s.mono}>{suggestion.where}</span>
              </span>
            </span>
            {suggestion.in === undefined ? (
              <Button
                size="small"
                icon="plus"
                aria-label={t.addLabel(suggestion.name)}
                data-refocus="found"
                // Where it is among the Add buttons: one in another project has none.
                onClick={() => onAdd(suggestion.id, shown.slice(0, row).filter((before) => before.in === undefined).length)}
              >
                {t.add}
              </Button>
            ) : (
              <span className={s.in}>{t.inProject(suggestion.in)}</span>
            )}
          </li>
        ))}
      </ul>
      {!all && found.more.length > 0 && (
        <p className={s.more}>
          <LinkButton onClick={() => setAll(true)}>{t.more(found.more.length)}</LinkButton>
        </p>
      )}
    </section>
  )
}
