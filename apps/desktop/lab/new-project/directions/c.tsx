import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { ThreadItem } from '@althar/contracts'
import { Button, Field, Icon, Room, SetupPick, SetupPicks, SetupRepositories } from '@althar/ui'

import { newProjectId } from '../../../src/renderer/data/client'
import { useServices } from '../../../src/renderer/data/services'
import { draftsOf } from '../../../src/renderer/features/newProject/draft'
import { items } from '../../../tests/fixtures'
import {
  ACCOUNT,
  FOUND,
  HOME,
  HOSTS,
  inkOfSource,
  type JobHandle,
  makeOnHome,
  nameOf,
  On,
  on,
  pastedOf,
  REPOS,
  type Source,
  slugOf,
  whereOf,
  world,
} from '../world'
import { HomeReady } from './parts'
import p from './parts.module.css'
import cc from './c.module.css'

/*
 * C · Pick and go. Where a project is asked for, the page is the picker:
 * your repositories, found as they're typed or by a URL pasted, a folder on
 * the home, or a name to start empty. One press makes the project, named and
 * coloured from what was picked, and the window is on it at once, as the
 * New project tab becomes the project's: the home's clone said in its
 * conversation as it comes, the composer ready for its first task meanwhile.
 * A clone that drops is tried again by itself; renaming is in its settings.
 */

const notice = (title: string, description: string | null, severity: 'info' | 'warning' = 'info'): ThreadItem =>
  items.notice({ title, description, source: 'runtime', severity }, null)

/** The home's job, said in the project's conversation, one line kept up to date as it goes. */
const narrate = (projectId: string, source: Source, handle: JobHandle) => {
  const where = whereOf(source)
  const what = source.kind === 'clone' ? `${source.repo.owner}/${source.repo.name}` : nameOf(source)
  const first = notice(
    source.kind === 'clone' ? `Cloning ${what} ${on}` : source.kind === 'folder' ? `Opening ${what} ${on}` : `Making ${slugOf(what)} ${on}`,
    where,
  )
  world.say(projectId, first)
  let retried = false
  const off = handle.subscribe(() => {
    const job = handle.get()
    const signing = job.steps.find((step) => step.key === 'github')?.state === 'doing'
    const read = job.steps.find((step) => step.key === 'read')
    if (job.phase === 'failed') {
      world.resay(projectId, first.id, () => ({
        ...notice(`${job.problem ?? 'It stopped.'} Trying again…`, where, 'warning'),
        id: first.id,
      }))
      if (!retried) {
        retried = true
        setTimeout(() => handle.retry(), 1600)
      }
      return
    }
    if (job.phase === 'done') {
      off()
      world.resay(projectId, first.id, () => ({
        ...notice(`${nameOf(source)} is ${on}, in ${where}`, read?.detail ?? null),
        id: first.id,
      }))
      return
    }
    const detail = signing
      ? `Signing GitHub in ${on} as ${ACCOUNT}: approve it in your browser on this Mac`
      : job.progress !== null
        ? `${where} · ${job.progress.done} of ${job.progress.total} MB`
        : read?.state === 'doing'
          ? `${where} · reading it`
          : where
    world.resay(projectId, first.id, (was) => ({ ...was, content: { ...(was.content as object), description: detail } }) as ThreadItem)
  })
}

export function CPage({ first = false, onCreated }: { first?: boolean; onCreated?: (projectId: string) => void; onClose?: () => void }) {
  const { client } = useServices()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [other, setOther] = useState<'folder' | 'new' | null>(null)
  const [fresh, setFresh] = useState('')
  const [path, setPath] = useState('')
  const pasted = pastedOf(query)
  const go = (source: Source) => {
    const drafts = draftsOf(client)
    const id = first ? newProjectId() : (drafts.get()?.id ?? newProjectId())
    const name = nameOf(source)
    drafts.change(id, (now) => ({ ...now, name }))
    const handle = makeOnHome({ id, name, ink: inkOfSource(source), source, early: true })
    narrate(id, source, handle)
    onCreated?.(id)
    void navigate({ to: '/projects/$projectId', params: { projectId: id }, search: { room: Room.Both } })
  }
  const chooseRepo = (id: string) => {
    const repo = REPOS.find((one) => one.id === id) ?? (pasted?.id === id ? pasted : undefined)
    if (repo !== undefined) go({ kind: 'clone', repo })
  }
  return (
    <main className={cc.page}>
      <div className={cc.column}>
        <h1 className={cc.title}>{first ? `No projects ${on} yet` : `New project ${on}`}</h1>
        {first && (
          <p className={cc.lede}>
            Pick its code and it’s made. {HOME.remote ? `The clone comes onto ${HOME.name} while you start on it.` : ''}
          </p>
        )}
        <SetupRepositories
          hosts={HOSTS}
          repositories={REPOS}
          query={query}
          onQuery={setQuery}
          pasted={pasted}
          chosen={null}
          onChoose={chooseRepo}
          onConnect={() => undefined}
          height={first ? 216 : 300}
          text={{ cloneRow: 'Clone', find: 'Find a repository, or paste its URL' }}
        />
        <SetupPicks label="Or">
          <SetupPick
            checked={other === 'folder'}
            onChoose={() => setOther(other === 'folder' ? null : 'folder')}
            mark={<Icon name="folder" size={15} />}
            title={`A folder ${on}`}
            note={`${FOUND.length} found`}
          >
            <ul className={cc.found}>
              {FOUND.map((one) => (
                <li key={one.id}>
                  <button type="button" className={cc.foundRow} onClick={() => go({ kind: 'folder', folder: one })}>
                    <span className={cc.foundName}>{one.name}</span>
                    <span className={p.mono}>{one.where}</span>
                    <span className={cc.foundAct}>
                      <Icon name="plus" size={12} />
                      Open
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className={p.pathRow}
              onSubmit={(event) => {
                event.preventDefault()
                const at = path.trim()
                if (at === '') return
                const name = at.replace(/\/+$/, '').split('/').at(-1) ?? at
                go({
                  kind: 'folder',
                  folder: { ...FOUND[0]!, id: `typed:${at}`, name, where: at, facts: '', remote: null, reads: 'Read as it’s made' },
                })
              }}
            >
              <Field
                className={p.path}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={HOME.remote ? '/srv/apps/billing' : '~/Code/billing'}
                aria-label={`A folder ${on}, by its path`}
                spellCheck={false}
                autoComplete="off"
              />
              <Button size="small" type="submit" disabled={path.trim() === ''}>
                Open
              </Button>
            </form>
          </SetupPick>
          <SetupPick
            checked={other === 'new'}
            onChoose={() => setOther(other === 'new' ? null : 'new')}
            mark={<Icon name="create" size={15} />}
            title="Start empty"
            note={`A new repository ${on}`}
          >
            <form
              className={p.pathRow}
              onSubmit={(event) => {
                event.preventDefault()
                if (fresh.trim() !== '') go({ kind: 'new', name: fresh.trim() })
              }}
            >
              <Field
                className={cc.freshName}
                value={fresh}
                onChange={(event) => setFresh(event.target.value)}
                placeholder="Name it"
                aria-label="Its name"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <Button size="small" type="submit" variant="signal" disabled={fresh.trim() === ''}>
                Make it
              </Button>
            </form>
            {fresh.trim() !== '' && <p className={cc.freshWhere}>{whereOf({ kind: 'new', name: fresh })}</p>}
          </SetupPick>
        </SetupPicks>
        {HOME.remote ? (
          <section className={cc.ready} aria-label={On}>
            <p className={cc.readyTitle}>
              {On}, clones go in {HOME.place}
            </p>
            <HomeReady label={`Ready ${on}`} />
          </section>
        ) : (
          <p className={cc.foot}>
            {On}: clones go in {HOME.place}.
          </p>
        )}
      </div>
    </main>
  )
}
