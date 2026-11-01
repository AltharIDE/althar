// Scrappy: a repository's recorded setup in a tab of its own, its commands as code, and three ways to show the files copied in under them.
import { type ReactNode, useState } from 'react'

import { Icon, IconButton, SettingGroup } from '@althar/ui'

import { Editor } from './Editor'
import s from './proto.module.css'
import { proto, type Repo, useProto } from './state'

const text = {
  title: 'Before each task starts',
  commands: 'Commands',
  copy: 'Copied from your checkout',
  unrecorded: 'The first task’s lead fills this in.',
  nothing: 'Needs nothing.',
  noFiles: 'No files.',
  addFile: 'Add a file',
  filePlaceholder: '.env.local',
  remove: (path: string) => `Don’t copy ${path}`,
  commandsOf: (repo: string) => `${repo}: commands`,
  copyOf: (repo: string) => `${repo}: files copied from your checkout`,
}

const placeholderOf = (repo: Repo) => (repo.commands === null ? text.unrecorded : text.nothing)

/** A label inside the card, over the part it names. */
function Part({ children }: { children: string }) {
  return <div className={s.part}>{children}</div>
}

function Commands({ repo }: { repo: Repo }) {
  return (
    <Editor
      lines={repo.commands}
      label={text.commandsOf(repo.name)}
      placeholder={placeholderOf(repo)}
      onSave={(commands) => proto.change(repo.id, { commands })}
    />
  )
}

const files = (repo: Repo) => repo.copy ?? []
const setFiles = (repo: Repo, copy: ReadonlyArray<string>) => proto.change(repo.id, { copy: [...copy] })

/** Folders quiet, the file's name plain. */
function Path({ path }: { path: string }) {
  const at = path.lastIndexOf('/')
  return (
    <span className={s.mono}>
      {at >= 0 ? <span className={s.dim}>{path.slice(0, at + 1)}</span> : null}
      {path.slice(at + 1)}
    </span>
  )
}

/** One path typed in, added on Enter, left on Escape or when it's empty. */
function AddFile({ repo, className }: { repo: Repo; className: string | undefined }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const done = () => {
    const next = path.trim()
    if (next !== '' && !files(repo).includes(next)) setFiles(repo, [...files(repo), next])
    setPath('')
    setOpen(false)
  }
  if (!open)
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} />
        {text.addFile}
      </button>
    )
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: opened by a click to type in.
      autoFocus
      className={s.addInput}
      aria-label={text.addFile}
      placeholder={text.filePlaceholder}
      value={path}
      onChange={(event) => setPath(event.target.value)}
      onBlur={done}
      onKeyDown={(event) => {
        if (event.key === 'Enter') done()
        if (event.key === 'Escape') {
          setPath('')
          setOpen(false)
        }
      }}
    />
  )
}

/* ——— A · Under a line: the files as a second editor under the commands. ——— */

function UnderALine({ repo }: { repo: Repo }) {
  return (
    <>
      <Part>{text.commands}</Part>
      <Commands repo={repo} />
      <Part>{text.copy}</Part>
      <Editor
        lines={repo.copy}
        label={text.copyOf(repo.name)}
        placeholder={text.noFiles}
        copies
        onSave={(copy) => proto.change(repo.id, { copy })}
      />
    </>
  )
}

/* ——— B · Files: a row of the files under the commands, each taken out with ×. ——— */

function AsFiles({ repo }: { repo: Repo }) {
  return (
    <>
      <Commands repo={repo} />
      <div className={s.fileRow}>
        <span className={s.fileLabel}>{text.copy}</span>
        {files(repo).map((path) => (
          <span key={path} className={s.fileChip}>
            <Icon name="file" size={12} className={s.dim} />
            <Path path={path} />
            <IconButton
              icon="close"
              size="small"
              label={text.remove(path)}
              onClick={() =>
                setFiles(
                  repo,
                  files(repo).filter((one) => one !== path),
                )
              }
            />
          </span>
        ))}
        <AddFile repo={repo} className={s.addChip} />
      </div>
    </>
  )
}

/* ——— C · One line: the files said in a line at the foot, changed in place. ——— */

function OneLine({ repo }: { repo: Repo }) {
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState('')
  const open = () => {
    setTyped(files(repo).join(', '))
    setEditing(true)
  }
  const done = () => {
    setFiles(
      repo,
      typed
        .split(/[,\n]/)
        .map((one) => one.trim())
        .filter((one) => one !== ''),
    )
    setEditing(false)
  }
  let line: ReactNode = <span className={s.dim}>{text.noFiles}</span>
  if (files(repo).length > 0)
    line = files(repo).map((path, at) => (
      <span key={path}>
        {at > 0 ? <span className={s.dim}>, </span> : null}
        <Path path={path} />
      </span>
    ))
  return (
    <>
      <Commands repo={repo} />
      <div className={s.foot}>
        <Icon name="copy" size={13} className={s.dim} />
        <span className={s.fileLabel}>{text.copy}</span>
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by a click to type in.
            autoFocus
            className={s.footInput}
            aria-label={text.copyOf(repo.name)}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={done}
            onKeyDown={(event) => {
              if (event.key === 'Enter') done()
              if (event.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button type="button" className={s.footLine} onClick={open} aria-label={text.copyOf(repo.name)}>
            {line}
          </button>
        )}
      </div>
    </>
  )
}

/** One card, a tab for each repository, its checkout at the end of the tabs. */
function Tabs({ repos, Body }: { repos: ReadonlyArray<Repo>; Body: (p: { repo: Repo }) => ReactNode }) {
  const [on, setOn] = useState(repos[0]?.id)
  const repo = repos.find((one) => one.id === on) ?? repos[0]
  if (repo === undefined) return null
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {repos.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={one.id === repo.id}
            className={one.id === repo.id ? s.tabOn : s.tab}
            onClick={() => setOn(one.id)}
          >
            <Icon name="folder" size={13} className={s.headIcon} />
            {one.name}
          </button>
        ))}
        <span className={s.tabsEnd}>{repo.checkout}</span>
      </div>
      <div role="tabpanel" key={repo.id}>
        <Body repo={repo} />
      </div>
    </section>
  )
}

/** In Running, after what the project runs. */
export function ProtoFolders() {
  const p = useProto()
  const Body = p.direction === 'A' ? UnderALine : p.direction === 'B' ? AsFiles : OneLine
  return (
    <SettingGroup title={text.title} headingLevel={3}>
      <Tabs key={`${p.direction}:${p.which}:${p.moment}`} repos={p.repos} Body={Body} />
    </SettingGroup>
  )
}
