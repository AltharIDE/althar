import { type CSSProperties, useEffect, useState } from 'react'

import { Brand, BrandMark, Button, Dialog, Field, Icon, InkSwatches, ProjectInk, ProjectMark, type SetupWay, Spinner } from '@althar/ui'

import { newProjectId } from '../../../src/renderer/data/client'
import c from '../../../src/renderer/features/homes/Connect.module.css'
import st from '../../../src/renderer/features/start/Start.module.css'
import type { makeRouter } from '../../../src/renderer/router'
import { guide } from '../entries'
import { ACCOUNT, HOME, inkOfSource, type JobHandle, makeOnHome, nameOf, on, type Source, whereOf } from '../world'
import { HomeReady, HomeSteps, SourceBody, useJob, usePick } from './parts'
import b from './b.module.css'

/*
 * B · Guided steps, drawn as Connect a home is: the same dialog and drawing
 * board, where the code comes from on the left and the home on the right,
 * joined by a line drawn as the code travels. One question a page: which
 * way, which repository or folder, then its name and colour beside what the
 * home has ready for it; then the home's steps as it makes it, and Open.
 * Closed while it's made, it goes on, and the project shows when it's there.
 */

type Step = 'way' | 'pick' | 'name' | 'ready' | 'make'

const WAYS: ReadonlyArray<{ id: SetupWay; title: string; line: string }> = [
  { id: 'clone', title: 'Clone a repository', line: `From GitHub, onto ${HOME.name}` },
  { id: 'folder', title: 'A folder there', line: HOME.remote ? `Already on ${HOME.name}` : 'Already on this Mac' },
  { id: 'new', title: 'Start empty', line: 'A new repository' },
]

/** The view transition Connect a home moves its pages with: the box takes its new height, the drawing stays. */
const morph = (change: () => void) => {
  const start = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition
  if (start === undefined || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  start.call(document, change)
}

/** Where the code comes from, as the drawing's left card. */
function SourceCard({ way, source }: { way: SetupWay; source: Source | null }) {
  const mark =
    way === 'clone' ? <BrandMark brand={Brand.GitHub} size={15} /> : <Icon name={way === 'new' ? 'create' : 'folder'} size={15} />
  const name =
    source === null
      ? way === 'clone'
        ? 'GitHub'
        : way === 'folder'
          ? 'A folder'
          : 'New repository'
      : source.kind === 'clone'
        ? `${source.repo.owner}/${source.repo.name}`
        : nameOf(source)
  const where =
    source?.kind === 'clone'
      ? source.repo.private
        ? 'Private'
        : 'Public'
      : source?.kind === 'folder'
        ? source.folder.where
        : way === 'clone'
          ? ACCOUNT
          : 'git init'
  return (
    <div className={`${c.card} ${b.source}`} data-here="">
      <span className={c.glyph}>{mark}</span>
      <span className={c.words}>
        <span className={c.name} title={name}>
          {name}
        </span>
        <span className={c.where}>{where}</span>
      </span>
    </div>
  )
}

function Drawing({
  way,
  source,
  id,
  name,
  ink,
  stage,
  how,
}: {
  way: SetupWay
  source: Source | null
  id: string
  name: string
  ink: ProjectInk
  stage: string
  how: string
}) {
  const made = stage === 'connected'
  return (
    <div className={c.board} data-stage={stage}>
      <SourceCard way={way} source={source} />
      <div className={c.wire} aria-hidden="true">
        <span className={c.how}>{how}</span>
        <svg className={c.line} viewBox="0 0 100 12" preserveAspectRatio="none">
          {stage === 'refused' ? (
            <>
              <line x1="0" y1="6" x2="40" y2="6" vectorEffect="non-scaling-stroke" />
              <line x1="60" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            <line x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
          )}
          {stage === 'connecting' && <line className={c.comet} x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className={c.node}>
          {stage === 'refused' && <Icon name="close" size={11} />}
          {made && <Icon name="check" size={12} />}
        </span>
      </div>
      <div className={c.card} data-home="" data-found={made || undefined}>
        <div className={c.head}>
          <span className={c.glyph}>
            <Icon name={HOME.remote ? 'home' : 'computer'} size={15} />
          </span>
          <span className={c.words}>
            <span className={c.name}>{HOME.remote ? HOME.name : 'This Mac'}</span>
            <span className={c.where} data-empty={source === null || undefined}>
              {source === null ? HOME.place : whereOf(source)}
            </span>
          </span>
        </div>
        <span className={`${c.shelf} ${b.shelf}`}>
          {name.trim() === '' ? (
            <span className={b.blank} aria-hidden="true" />
          ) : (
            <ProjectMark seed={id} ink={ink} size={26} running={stage === 'connecting'} />
          )}
          <span className={b.projectName} data-empty={name.trim() === '' || undefined}>
            {name.trim() === '' ? 'New project' : name.trim()}
          </span>
        </span>
      </div>
    </div>
  )
}

export function Guide({ router }: { router: ReturnType<typeof makeRouter> }) {
  const pick = usePick(HOME.remote ? 'clone' : 'folder')
  const [step, setStep] = useState<Step>('way')
  const [id] = useState(() => newProjectId())
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [ink, setInk] = useState<ProjectInk | null>(null)
  const [handle, setHandle] = useState<JobHandle | null>(null)
  const job = useJob(handle)
  const source = pick.source
  useEffect(() => {
    if (!named && source !== null) setName(nameOf(source))
  }, [source, named])
  const shownInk = ink ?? (source === null ? ProjectInk.Teal : inkOfSource(source))
  const go = (next: Step) => morph(() => setStep(next))

  const running = job?.phase === 'running'
  const stage =
    job === null
      ? source === null
        ? 'idle'
        : 'found'
      : job.phase === 'failed'
        ? 'refused'
        : job.phase === 'done'
          ? 'connected'
          : 'connecting'
  const how =
    job?.progress != null && running
      ? `${Math.round((job.progress.done / job.progress.total) * 100)}%`
      : pick.way === 'clone'
        ? 'git clone'
        : pick.way === 'folder'
          ? 'opened in place'
          : 'git init'
  const named_ = name.trim() === '' ? 'it' : name.trim()
  const title =
    step === 'way'
      ? `New project ${on}`
      : step === 'pick'
        ? pick.way === 'clone'
          ? 'Which repository'
          : pick.way === 'folder'
            ? 'Which folder'
            : 'Name the repository'
        : step === 'name'
          ? 'Name the project'
          : step === 'ready'
            ? `Ready ${on}`
            : job?.phase === 'done'
              ? `${named_} is ${on}`
              : job?.phase === 'failed'
                ? `${named_} stopped partway`
                : `Making ${named_} ${on}`
  const make = () => {
    if (source === null || name.trim() === '') return
    setHandle(makeOnHome({ id, name: name.trim(), ink: shownInk, source }))
    go('make')
  }
  const open = () => {
    guide.close()
    void router.navigate({ to: '/projects/$projectId', params: { projectId: id } })
  }
  const submit = () => {
    if (step === 'way') return go('pick')
    if (step === 'pick') return source !== null && go('name')
    if (step === 'name') return HOME.remote ? go('ready') : make()
    if (step === 'ready') return make()
    if (job?.phase === 'failed') return handle?.retry()
    if (job?.phase === 'done') return open()
  }
  const back = step === 'pick' ? () => go('way') : step === 'name' ? () => go('pick') : step === 'ready' ? () => go('name') : undefined
  return (
    <Dialog
      title={title}
      width={660}
      className={c.dialog}
      holding={running}
      // Closed while it's made, it goes on; the project shows once it's there.
      onClose={() => guide.close()}
      {...(back === undefined ? {} : { onBack: back })}
      onSubmit={submit}
      actions={
        step === 'make' ? (
          job?.phase === 'done' ? (
            <>
              <Button onClick={() => guide.close()}>Close</Button>
              <Button type="submit" variant="signal">
                Open {named_}
              </Button>
            </>
          ) : job?.phase === 'failed' ? (
            <>
              <Button onClick={() => guide.close()}>Cancel</Button>
              <Button type="submit" variant="signal">
                Try again
              </Button>
            </>
          ) : (
            <Button onClick={() => guide.close()}>Close</Button>
          )
        ) : (
          <>
            <Button onClick={() => guide.close()}>Cancel</Button>
            <Button
              type="submit"
              variant="signal"
              disabled={(step === 'pick' && source === null) || (step === 'name' && name.trim() === '')}
            >
              {step === 'ready' || (step === 'name' && !HOME.remote) ? `Make ${named_}` : 'Continue'}
            </Button>
          </>
        )
      }
    >
      <Drawing way={pick.way} source={source} id={id} name={name} ink={shownInk} stage={stage} how={how} />
      <div className={c.body} style={{ '--ink': `var(--project-${shownInk})` } as CSSProperties}>
        {step === 'way' && (
          <div className={b.ways} role="radiogroup" aria-label="Where its code comes from">
            {WAYS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="radio"
                aria-checked={pick.way === one.id}
                className={c.route}
                onClick={() => pick.onWay(one.id)}
                onDoubleClick={() => {
                  pick.onWay(one.id)
                  go('pick')
                }}
              >
                <span className={c.glyph}>
                  {one.id === 'clone' ? (
                    <BrandMark brand={Brand.GitHub} size={15} />
                  ) : (
                    <Icon name={one.id === 'new' ? 'create' : 'folder'} size={15} />
                  )}
                </span>
                <span className={c.words}>
                  <span className={c.routeTitle}>{one.title}</span>
                  <span className={c.routeLine}>{one.line}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {step === 'pick' && <SourceBody pick={pick} height={232} autoFocus />}
        {step === 'name' && (
          <div className={b.name}>
            <label className={b.label} htmlFor="guide-name">
              Name
            </label>
            <Field
              id="guide-name"
              size="large"
              value={name}
              autoFocus
              onChange={(event) => {
                setNamed(true)
                setName(event.target.value)
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <span className={b.label}>Colour</span>
            <InkSwatches value={shownInk} onChange={setInk} text={{ label: 'Colour' }} />
          </div>
        )}
        {step === 'ready' && (
          <div className={b.make}>
            <HomeReady label={`Ready ${on}`} />
            <p className={b.note}>Each sign-in is approved in your browser on this Mac. What you leave is asked for when work needs it.</p>
          </div>
        )}
        {step === 'make' && job !== null && (
          <div className={b.make}>
            <HomeSteps job={job} label={`Making ${named_} ${on}`} />
            {job.phase === 'failed' && job.problem !== null && (
              <p className={b.problem}>
                <Icon name="problem" size={13} />
                {job.problem} Trying again clones it from the start.
              </p>
            )}
            {job.phase === 'running' && (
              <p className={b.note}>
                <Spinner size="small" />
                Closing this doesn’t stop it. {named_} shows {on} once it’s there.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** A home with no projects, for B: said, with New project, which opens the steps. */
export function BEmpty() {
  return (
    <main className={st.remoteEmpty}>
      <Icon name="home" size={28} className={st.remoteGlyph} />
      <h1>No projects {on} yet</h1>
      <p>Its tasks run {on}, on a repository cloned onto it, a folder that’s there, or one started empty.</p>
      <div className={b.emptyActions}>
        <Button variant="signal" icon="plus" onClick={() => guide.open()}>
          New project
        </Button>
      </div>
    </main>
  )
}
