import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { Brand, BrandMark, Button, Icon, LinkButton, ProjectInk, SetupSection, SetupSource, SetupWays, SetupZone } from '@althar/ui'
import { NewProject, type NewProjectFolder } from '@althar/ui/screens'

import { useServices } from '../../../src/renderer/data/services'
import { draftsOf } from '../../../src/renderer/features/newProject/draft'
import n from '../../../src/renderer/features/newProject/NewProject.module.css'
import st from '../../../src/renderer/features/start/Start.module.css'
import { startNew } from '../entries'
import { HOME, HOSTS, inkOfSource, type JobHandle, makeOnHome, nameOf, On, on, whereOf } from '../world'
import { folderOf, HomeReady, HomeSteps, SourceBody, useDone, useJob, usePick, waysText } from './parts'
import a from './a.module.css'

/*
 * A · The New project page, on the home. The tab the + opens today, the
 * same on every home: its name and mark on the left, where its code comes
 * from on the right, the three ways in the home's words (a clone lands on
 * it, a folder is one found there or typed by its path, a new repository is
 * made there). Under them, what the home will do, and as it's made, each
 * step ticking in place. A home with no projects says so, with New project.
 */

export function AEmpty() {
  return (
    <main className={st.remoteEmpty}>
      <Icon name="home" size={28} className={st.remoteGlyph} />
      <h1>No projects {on} yet</h1>
      <p>Clone a repository onto it, open a folder that’s there, or start one empty. Its tasks run {on}.</p>
      <div className={a.emptyActions}>
        <Button variant="signal" icon="plus" onClick={() => startNew()}>
          New project
        </Button>
      </div>
    </main>
  )
}

export function APage({ onCreated, onClose }: { onCreated: (projectId: string) => void; onClose: () => void }) {
  const { client } = useServices()
  const store = draftsOf(client)
  const draft = useSyncExternalStore(store.subscribe, store.get)
  useEffect(() => {
    if (store.get() === null) store.start()
  }, [store])
  const navigate = useNavigate()
  const pick = usePick(HOME.remote ? 'clone' : 'folder')
  const [handle, setHandle] = useState<JobHandle | null>(null)
  const job = useJob(handle)
  useDone(job, onCreated)
  const id = draft?.id ?? ''
  const name = draft?.name ?? ''
  const [named, setNamed] = useState(false)
  // Unnamed, it takes the name of what its code comes from.
  useEffect(() => {
    if (!named && pick.source !== null) store.change(id, (now) => ({ ...now, name: nameOf(pick.source!) }))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- as the choice changes
  }, [pick.source])
  if (draft === null) return null
  const ink = (draft.ink ?? (pick.source === null ? ProjectInk.Teal : inkOfSource(pick.source))) as ProjectInk
  const creating = job !== null && job.phase === 'running'
  const source = pick.source
  const folders: readonly NewProjectFolder[] =
    creating && source?.kind === 'clone'
      ? [
          {
            id: source.repo.id,
            reading: true,
            name: source.repo.name,
            cloning: { host: { name: 'GitHub' }, remote: source.repo.name, where: whereOf(source) },
          },
        ]
      : folderOf(source)
  const making = job !== null
  const sourceCard =
    making && source !== null ? (
      <SetupZone>
        <SetupSource
          mark={
            source.kind === 'clone' ? (
              <BrandMark brand={Brand.GitHub} size={22} />
            ) : (
              <Icon name={source.kind === 'new' ? 'create' : 'folder'} size={18} />
            )
          }
          {...(source.kind === 'clone' ? { owner: source.repo.owner } : {})}
          name={source.kind === 'clone' ? source.repo.name : nameOf(source)}
          where={`${whereOf(source)} ${on}`}
          {...(job.progress !== null && job.phase === 'running' ? { facts: `${job.progress.done} of ${job.progress.total} MB` } : {})}
          filling={creating && job.steps.find((one) => one.key === 'code')?.state === 'doing'}
        />
      </SetupZone>
    ) : null
  return (
    <div className={n.window}>
      <NewProject
        seed={id}
        name={name}
        onNameChange={(next) => {
          setNamed(true)
          store.change(id, (now) => ({ ...now, name: next }))
        }}
        ink={ink}
        onInkChange={(next) => store.change(id, (now) => ({ ...now, ink: next as never }))}
        folders={folders}
        onRemove={() => pick.choose(pick.chosen ?? '')}
        onChoose={() => pick.onWay('folder')}
        found={null}
        onAdd={() => undefined}
        side={
          <fieldset className={n.fieldset} disabled={creating}>
            <div className={n.stack}>
              <SetupWays way={pick.way} onWay={pick.onWay} hosts={HOSTS} minHeight={260} text={waysText}>
                {sourceCard ?? <SourceBody pick={pick} height={220} />}
              </SetupWays>
              {(HOME.remote || job !== null) && (
                <SetupSection title={On} status={job === null ? 'idle' : job.phase === 'done' ? 'done' : creating ? 'doing' : 'idle'}>
                  {job === null ? (
                    <HomeReady
                      label={`Ready ${on}`}
                      onSettings={() => void navigate({ to: '/settings/$section', params: { section: 'tasks' } })}
                    />
                  ) : (
                    <HomeSteps job={job} label={`Making ${name} ${on}`} />
                  )}
                </SetupSection>
              )}
            </div>
          </fieldset>
        }
        onCreate={() => {
          if (source === null) return
          if (handle !== null && job?.phase === 'failed') return handle.retry()
          setHandle(makeOnHome({ id, name: name.trim(), ink, source }))
        }}
        onCancel={onClose}
        creating={creating}
        {...(job?.phase === 'failed' && job.problem !== null
          ? {
              error: (
                <>
                  {job.problem} <LinkButton onClick={() => handle?.retry()}>Try again</LinkButton>
                </>
              ),
            }
          : {})}
        text={{
          found: On,
          needsFolder: 'Choose where its code comes from first.',
          create: (named) => (job?.phase === 'failed' ? 'Try again' : `Create ${named}`),
        }}
      />
    </div>
  )
}
