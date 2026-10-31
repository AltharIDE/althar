// Scrappy: each direction's view of a repository's recorded setup, from the kit's own parts, where it sits in project settings.
import { useId, useState } from 'react'

import {
  Button,
  Code,
  CodeBlock,
  FieldArea,
  FormRow,
  Icon,
  KeyValues,
  LinkButton,
  Panel,
  SettingGroup,
  SettingList,
  SettingRow,
} from '@althar/ui'

import { PROJECT_GROUPS } from '../../src/renderer/features/projectSettings/sections'
import s from './proto.module.css'
import { proto, type Repo, type Setup, useProto } from './state'

const text = {
  title: 'New task folders',
  note: 'Set up like this before each task’s lead starts.',
  copies: 'Copies',
  runs: 'Runs',
  recorded: 'Recorded',
  last: 'Last time',
  by: (title: string, at: string) => `${title} · ${at}`,
  byYou: (at: string) => `Changed by you · ${at}`,
  none: 'Not recorded yet. The next task’s lead works it out and records it.',
  noneShort: 'Not recorded yet',
  nothing: 'Nothing',
  change: 'Change',
  clear: 'Clear',
  save: 'Save',
  cancel: 'Cancel',
  copyLabel: 'Copy from your checkout',
  copyNote: 'One file or folder a line, from the repository’s root.',
  runLabel: 'Run',
  runNote: 'One command a line, in order. Althar stops at the first that fails.',
  wentThrough: (title: string, at: string) => `Went through in ${title} · ${at}`,
  failed: (title: string, at: string, code?: number) => `Failed${code === undefined ? '' : ` with exit code ${code}`} in ${title} · ${at}`,
}

/** Opens the task that recorded it, in the app. */
const openTask = (threadId: string) => window.location.assign(`#/threads/${threadId}`)

/** Rerenders the page's own parts when the direction changes. */
export const useProtoDirection = () => useProto().direction

/** The settings' side: C gives the setups a section of their own, after Running. */
export const protoGroups = (): ReadonlyArray<ReadonlyArray<string>> =>
  proto.get().direction === 'C'
    ? PROJECT_GROUPS.map((group) => (group.includes('running') ? [...group, 'folders'] : group))
    : PROJECT_GROUPS

/** Who recorded it, as a link to that task, and when. */
function RecordedBy({ setup }: { setup: Setup }) {
  if (setup.by === null) return <>{text.byYou(setup.at)}</>
  const by = setup.by
  return (
    <>
      <LinkButton onClick={() => openTask(by.threadId)}>{by.title}</LinkButton>
      {` · ${setup.at}`}
    </>
  )
}

/** A repository's setup opened to change, in place: what it copies and what it runs, a line each. */
function Editor({ repo, onDone }: { repo: Repo; onDone: () => void }) {
  const copyId = useId()
  const runId = useId()
  const [copy, setCopy] = useState((repo.setup?.copy ?? []).join('\n'))
  const [run, setRun] = useState((repo.setup?.commands ?? []).join('\n'))
  const lines = (words: string) =>
    words
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  return (
    <form
      className={s.editor}
      onSubmit={(event) => {
        event.preventDefault()
        proto.change(repo.id, { copy: lines(copy), commands: lines(run) })
        onDone()
      }}
    >
      <FormRow label={text.copyLabel} note={text.copyNote} htmlFor={copyId}>
        <FieldArea id={copyId} className={s.mono} rows={3} value={copy} onChange={(event) => setCopy(event.target.value)} />
      </FormRow>
      <FormRow label={text.runLabel} note={text.runNote} htmlFor={runId}>
        <FieldArea id={runId} className={s.mono} rows={4} value={run} onChange={(event) => setRun(event.target.value)} />
      </FormRow>
      <div className={s.actions}>
        {repo.setup !== null && (
          <LinkButton
            className={s.danger}
            onClick={() => {
              proto.change(repo.id, null)
              onDone()
            }}
          >
            {text.clear}
          </LinkButton>
        )}
        <span className={s.grow} />
        <Button size="small" variant="quiet" onClick={onDone}>
          {text.cancel}
        </Button>
        <Button size="small" variant="signal" type="submit">
          {text.save}
        </Button>
      </div>
    </form>
  )
}

/* ——— A · Rows: a row each in Running, its facts under its name; Change opens it in place. ——— */

function Facts({ setup }: { setup: Setup }) {
  return (
    <span className={s.facts}>
      {setup.copy.length > 0 && (
        <span className={s.fact}>
          <span className={s.key}>{text.copies}</span>
          <span className={s.chips}>
            {setup.copy.map((path) => (
              <Code key={path}>{path}</Code>
            ))}
          </span>
        </span>
      )}
      {setup.commands.length > 0 && (
        <span className={s.fact}>
          <span className={s.key}>{text.runs}</span>
          <span className={s.commands}>
            {setup.commands.map((command, at) => (
              <Code key={`${at}:${command}`}>{command}</Code>
            ))}
          </span>
        </span>
      )}
      <span className={s.by}>
        <RecordedBy setup={setup} />
      </span>
    </span>
  )
}

function Rows({ repos }: { repos: ReadonlyArray<Repo> }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <SettingGroup title={text.title} note={text.note} headingLevel={3}>
      <SettingList>
        {repos.map((repo) => (
          <SettingRow
            key={repo.id}
            title={repo.name}
            note={repo.setup === null ? text.none : <Facts setup={repo.setup} />}
            mark={<Icon name="folder" size={15} className={s.glyph} />}
            {...(open === repo.id ? { under: <Editor repo={repo} onDone={() => setOpen(null)} /> } : {})}
          >
            {() => (open === repo.id ? null : <LinkButton onClick={() => setOpen(repo.id)}>{text.change}</LinkButton>)}
          </SettingRow>
        ))}
      </SettingList>
    </SettingGroup>
  )
}

/* ——— B · Script: each repository's setup as the script Althar runs, edited in place. ——— */

const scriptOf = (repo: Repo) =>
  [...(repo.setup?.copy ?? []).map((path) => `cp ${repo.checkout}/${path} ${path}`), ...(repo.setup?.commands ?? [])].join('\n')

function Script({ repos }: { repos: ReadonlyArray<Repo> }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <SettingGroup title={text.title} note={text.note} headingLevel={3}>
      <div className={s.scripts}>
        {repos.map((repo) => (
          <section key={repo.id} className={s.script} aria-label={repo.name}>
            <div className={s.scriptHead}>
              <span className={s.name}>{repo.name}</span>
              <span className={s.by}>{repo.setup === null ? text.noneShort : <RecordedBy setup={repo.setup} />}</span>
              <span className={s.grow} />
              {open !== repo.id && <LinkButton onClick={() => setOpen(repo.id)}>{text.change}</LinkButton>}
            </div>
            {open === repo.id ? (
              <Editor repo={repo} onDone={() => setOpen(null)} />
            ) : repo.setup === null ? (
              <p className={s.empty}>{text.none}</p>
            ) : (
              <CodeBlock code={scriptOf(repo)} lang="Shell" />
            )}
          </section>
        ))}
      </div>
    </SettingGroup>
  )
}

/* ——— C · Its own section: a sheet each, with how it went last time. ——— */

function Sheets({ repos }: { repos: ReadonlyArray<Repo> }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className={s.sheets}>
      <p className={s.lede}>{text.note}</p>
      {repos.map((repo) => (
        <Panel
          key={repo.id}
          title={repo.name}
          headingLevel={3}
          foot={
            open === repo.id ? undefined : (
              <>
                <span className={s.grow} />
                <Button size="small" variant="quiet" onClick={() => setOpen(repo.id)}>
                  {repo.setup === null ? 'Add' : text.change}
                </Button>
              </>
            )
          }
        >
          <div className={s.inset}>
            {open === repo.id ? (
              <Editor repo={repo} onDone={() => setOpen(null)} />
            ) : repo.setup === null ? (
              <p className={s.empty}>{text.none}</p>
            ) : (
              <KeyValues
                keyWidth={96}
                items={[
                  [
                    text.copies,
                    repo.setup.copy.length === 0 ? (
                      text.nothing
                    ) : (
                      <span className={s.chips}>
                        {repo.setup.copy.map((path) => (
                          <Code key={path}>{path}</Code>
                        ))}
                      </span>
                    ),
                  ],
                  [
                    text.runs,
                    <span key="runs" className={s.commands}>
                      {repo.setup.commands.map((command, at) => (
                        <Code key={`${at}:${command}`}>{command}</Code>
                      ))}
                    </span>,
                  ],
                  [text.recorded, <RecordedBy key="by" setup={repo.setup} />],
                  ...(repo.last === null
                    ? []
                    : [
                        [
                          text.last,
                          <span key="last" className={repo.last.ok ? undefined : s.failed}>
                            {repo.last.ok
                              ? text.wentThrough(repo.last.title, repo.last.at)
                              : text.failed(repo.last.title, repo.last.at, repo.last.code)}
                          </span>,
                        ] as const,
                      ]),
                ]}
              />
            )}
          </div>
        </Panel>
      ))}
    </div>
  )
}

/** The direction's view, where the settings page puts it: in Running for A and B, as its own section for C. */
export function ProtoFolders({ where }: { where: 'running' | 'section' }) {
  const p = useProto()
  if (where === 'running' && p.direction === 'A') return <Rows repos={p.repos} />
  if (where === 'running' && p.direction === 'B') return <Script repos={p.repos} />
  if (where === 'section' && p.direction === 'C') return <Sheets repos={p.repos} />
  return null
}
