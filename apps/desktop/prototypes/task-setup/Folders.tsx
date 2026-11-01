// Scrappy: each direction's way of showing a repository's recorded setup, as code to change in place, in project settings' Running.
import { useState } from 'react'

import { Icon, SettingGroup } from '@althar/ui'

import { Editor, shellLine } from './Editor'
import s from './proto.module.css'
import { proto, type Repo, useProto } from './state'

const text = {
  title: 'Before each task starts',
  commands: 'Commands',
  copy: 'Copied from your checkout',
  unrecorded: 'The first task’s lead fills this in.',
  nothing: 'Needs nothing.',
  noFiles: 'No files.',
  commandsOf: (repo: string) => `${repo}: commands`,
  copyOf: (repo: string) => `${repo}: files copied from your checkout`,
  scriptOf: (repo: string) => `${repo}: setup`,
}

const placeholderOf = (repo: Repo) => (repo.commands === null ? text.unrecorded : text.nothing)

/** A repository's name, and the checkout its files come from. */
function Head({ repo, term = false }: { repo: Repo; term?: boolean }) {
  return (
    <div className={term ? s.termHead : s.head}>
      <Icon name="folder" size={14} className={s.headIcon} />
      <span className={s.repoName}>{repo.name}</span>
      <span className={s.checkout}>{repo.checkout}</span>
    </div>
  )
}

/** A label inside a card, over the part it names. */
function Part({ children, term = false }: { children: string; term?: boolean }) {
  return <div className={term ? s.termPart : s.part}>{children}</div>
}

function Commands({ repo, tone }: { repo: Repo; tone?: 'term' }) {
  return (
    <Editor
      lines={repo.commands}
      label={text.commandsOf(repo.name)}
      placeholder={placeholderOf(repo)}
      {...(tone === undefined ? {} : { tone })}
      onSave={(commands) => proto.change(repo.id, { commands })}
    />
  )
}

function Files({ repo, tone }: { repo: Repo; tone?: 'term' }) {
  return (
    <Editor
      lines={repo.copy}
      label={text.copyOf(repo.name)}
      placeholder={text.noFiles}
      copies
      {...(tone === undefined ? {} : { tone })}
      onSave={(copy) => proto.change(repo.id, { copy })}
    />
  )
}

/* ——— A · Cards: a card each, its commands, then its files under a line. ——— */

function Cards({ repos }: { repos: ReadonlyArray<Repo> }) {
  return (
    <div className={s.cards}>
      {repos.map((repo) => (
        <section key={repo.id} className={s.card} aria-label={repo.name}>
          <Head repo={repo} />
          <Part>{text.commands}</Part>
          <Commands repo={repo} />
          <Part>{text.copy}</Part>
          <Files repo={repo} />
        </section>
      ))}
    </div>
  )
}

/* ——— B · Tabs: one card, a tab each; commands and files side by side. ——— */

function Tabs({ repos }: { repos: ReadonlyArray<Repo> }) {
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
      <div className={s.split} role="tabpanel" key={repo.id}>
        <div className={s.pane}>
          <Part>{text.commands}</Part>
          <Commands repo={repo} />
        </div>
        <div className={s.pane}>
          <Part>{text.copy}</Part>
          <Files repo={repo} />
        </div>
      </div>
    </section>
  )
}

/* ——— C · Terminal: a dark card each, like what a task's commands print. ——— */

function Terminals({ repos }: { repos: ReadonlyArray<Repo> }) {
  return (
    <div className={s.cards}>
      {repos.map((repo) => (
        <section key={repo.id} className={s.termCard} aria-label={repo.name}>
          <Head repo={repo} term />
          <Commands repo={repo} tone="term" />
          <Part term>{text.copy}</Part>
          <Files repo={repo} tone="term" />
        </section>
      ))}
    </div>
  )
}

/* ——— D · One script: a card each, its copies as the script's first lines. ——— */

const COPY = /^copy\s+/

const scriptColour = (line: string) => {
  if (!COPY.test(line)) return shellLine(line)
  const [word = '', path = ''] = [line.match(COPY)?.[0], line.replace(COPY, '')]
  return [<span key="w">{shellLine(word.trim())}</span>, word.slice(word.trim().length), ...shellLine(path, true)]
}

function Scripts({ repos }: { repos: ReadonlyArray<Repo> }) {
  return (
    <div className={s.cards}>
      {repos.map((repo) => {
        const lines = repo.commands === null ? null : [...(repo.copy ?? []).map((path) => `copy ${path}`), ...repo.commands]
        return (
          <section key={repo.id} className={s.card} aria-label={repo.name}>
            <Head repo={repo} />
            <Editor
              lines={lines}
              label={text.scriptOf(repo.name)}
              placeholder={placeholderOf(repo)}
              colour={scriptColour}
              onSave={(all) =>
                proto.change(repo.id, {
                  copy: all.filter((line) => COPY.test(line)).map((line) => line.replace(COPY, '')),
                  commands: all.filter((line) => !COPY.test(line)),
                })
              }
            />
          </section>
        )
      })}
    </div>
  )
}

/** In Running, after what the project runs. */
export function ProtoFolders() {
  const p = useProto()
  const Each = p.direction === 'A' ? Cards : p.direction === 'B' ? Tabs : p.direction === 'C' ? Terminals : Scripts
  return (
    <SettingGroup title={text.title} headingLevel={3}>
      <Each key={`${p.direction}:${p.which}:${p.moment}`} repos={p.repos} />
    </SettingGroup>
  )
}
