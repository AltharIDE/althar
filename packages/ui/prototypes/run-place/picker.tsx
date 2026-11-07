import { type ReactNode, useState } from 'react'

import { Brand } from '../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../src/foundations/Icon/Icon'
import { BrandMark } from '../../src/foundations/Marks/Marks'
import { Button } from '../../src/primitives/Button/Button'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Popover } from '../../src/primitives/Popover/Popover'
import { cx } from '../../src/lib/cx'
import s from '../../src/chrome/RunPlace/RunPlace.module.css'
import css from './picker.module.css'
import { type Direction, type PullRequest, type Repository, type Task } from './data'

/*
 * The three directions of where Run runs in a project of several
 * repositories. They share the chip beside Run and a popover; what differs is
 * how the popover names and groups the places. Each is drawn with the kit:
 * the real Button, Popover, Icon, LinkButton and the real picker's own row
 * styles, so the only thing on trial is the shape of the answer.
 */

/** Where one repository runs: its default branch, or a branch or pull request picked for it. */
export interface Pick {
  readonly kind: 'branch' | 'pull'
  readonly branch: string
  readonly number?: number
  readonly title?: string
}

export type Picks = Readonly<Record<string, Pick>>

export const placeOf = (repository: Repository, picks: Picks): Pick =>
  picks[repository.id] ?? { kind: 'branch', branch: repository.defaultBranch }

export const labelOf = (pick: Pick) => (pick.kind === 'pull' ? `!${pick.number ?? '?'}` : pick.branch)

export const changedOf = (repositories: readonly Repository[], picks: Picks) =>
  repositories.filter((repository) => picks[repository.id] !== undefined)

export const fullSummary = (repositories: readonly Repository[], picks: Picks, task: Task | null) =>
  task !== null
    ? `${task.title} · its worktree`
    : repositories.map((repository) => `${repository.name} ${labelOf(placeOf(repository, picks))}`).join(' · ')

/** The chip's words: a branch when there is one repository; the mix when there are several. */
export const chipOf = (
  repositories: readonly Repository[],
  picks: Picks,
  task: Task | null,
  direction: Direction,
): { label: string; mono: boolean } => {
  if (task !== null) return { label: task.title, mono: false }
  if (repositories.length === 1) return { label: labelOf(placeOf(repositories[0]!, picks)), mono: true }
  const changed = changedOf(repositories, picks)
  const rest = repositories.length - changed.length
  if (changed.length === 0)
    return { label: direction === 'C' ? `${repositories.length} repos · defaults` : 'Default branches', mono: false }
  if (changed.length === 1) {
    const one = changed[0]!
    const label = labelOf(placeOf(one, picks))
    return { label: `${one.name}: ${label} · ${rest} on default${rest === 1 ? '' : 's'}`, mono: true }
  }
  return { label: `${changed.length} picked · ${rest} on default${rest === 1 ? '' : 's'}`, mono: false }
}

export interface RunPlacePrototypeProps {
  readonly direction: Direction
  readonly repositories: readonly Repository[]
  readonly tasks: readonly Task[]
  readonly picks: Picks
  readonly task: Task | null
  readonly hostConnected: boolean
  readonly hostName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPickBranch: (repository: Repository, branch: string) => void
  readonly onPickPull: (repository: Repository, pull: PullRequest) => void
  readonly onPickTask: (task: Task) => void
  readonly onReset: () => void
  readonly onConnect: () => void
}

export function RunPlacePrototype({
  direction,
  repositories,
  tasks,
  picks,
  task,
  hostConnected,
  hostName,
  open,
  onOpenChange,
  onPickBranch,
  onPickPull,
  onPickTask,
  onReset,
  onConnect,
}: RunPlacePrototypeProps) {
  const single = repositories.length === 1
  const chip = chipOf(repositories, picks, task, direction)
  const current: IconName = task !== null ? 'agents' : single ? glyphOf(placeOf(repositories[0]!, picks)) : 'branch'
  const width = single ? 480 : direction === 'C' ? 660 : 540
  return (
    <Popover
      label="Where Run runs"
      placement="below"
      align="end"
      width={width}
      padded={false}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button
          size="small"
          variant="quiet"
          icon={current}
          trailingIcon="chevronD"
          className={cx(s.chip, css.chipWide)}
          title={fullSummary(repositories, picks, task)}
        >
          <span className={cx(s.chipLabel, chip.mono && s.mono)}>{chip.label}</span>
        </Button>
      }
    >
      {single ? (
        <Flat
          repositories={repositories}
          tasks={tasks}
          picks={picks}
          task={task}
          hostConnected={hostConnected}
          hostName={hostName}
          single
          onPickBranch={onPickBranch}
          onPickPull={onPickPull}
          onPickTask={onPickTask}
          onReset={onReset}
          onConnect={onConnect}
        />
      ) : direction === 'A' ? (
        <Flat
          repositories={repositories}
          tasks={tasks}
          picks={picks}
          task={task}
          hostConnected={hostConnected}
          hostName={hostName}
          single={false}
          onPickBranch={onPickBranch}
          onPickPull={onPickPull}
          onPickTask={onPickTask}
          onReset={onReset}
          onConnect={onConnect}
        />
      ) : direction === 'B' ? (
        <Grouped
          repositories={repositories}
          tasks={tasks}
          picks={picks}
          task={task}
          hostConnected={hostConnected}
          hostName={hostName}
          onPickBranch={onPickBranch}
          onPickPull={onPickPull}
          onPickTask={onPickTask}
          onConnect={onConnect}
        />
      ) : (
        <Board
          repositories={repositories}
          tasks={tasks}
          picks={picks}
          task={task}
          hostConnected={hostConnected}
          hostName={hostName}
          onPickBranch={onPickBranch}
          onPickPull={onPickPull}
          onPickTask={onPickTask}
          onReset={onReset}
          onConnect={onConnect}
        />
      )}
    </Popover>
  )
}

const glyphOf = (pick: Pick): IconName => (pick.kind === 'pull' ? 'pr' : 'branch')

/** What each direction shares: the field to find in, and the footer's plain words. */
function Field({ words, onWords }: { words: string; onWords: (words: string) => void }) {
  return (
    <div className={s.field}>
      <Icon name="search" size={13} className={s.glyph} />
      <input
        type="text"
        aria-label="Find a repository, branch, pull request or task"
        placeholder="Find a repository, branch, pull request or task"
        autoComplete="off"
        spellCheck={false}
        value={words}
        onChange={(event) => onWords(event.target.value)}
      />
    </div>
  )
}

function Foot({
  hostConnected,
  hostName,
  task,
  onConnect,
}: {
  hostConnected: boolean
  hostName: string
  task: Task | null
  onConnect: () => void
}) {
  return (
    <div className={cx(s.note, css.foot)}>
      {!hostConnected && (
        <span className={css.footLine}>
          {hostName} isn’t connected, so its merge requests aren’t here. <LinkButton onClick={onConnect}>Connect GitLab…</LinkButton>
        </span>
      )}
      <span className={css.footLine}>
        {task === null
          ? 'A branch picked here is also where new tasks work toward.'
          : 'A task runs in its own worktree, and never moves a branch.'}
      </span>
    </div>
  )
}

interface RowProps {
  readonly checked: boolean
  readonly glyph: IconName
  readonly title: ReactNode
  readonly number?: ReactNode
  readonly meta?: ReactNode
  readonly right?: ReactNode
  readonly accent?: boolean
  readonly onClick: () => void
}

/** One place, as the real picker draws it: a check, its glyph, its name, and quieter what it is. */
function Row({ checked, glyph, title, number, meta, right, accent = false, onClick }: RowProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      className={cx(s.row, css.rowButton, accent && css.accent)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span className={s.check}>{checked && <Icon name="check" size={12} />}</span>
      <Icon name={glyph} size={13} className={s.glyph} />
      <span className={s.main}>
        <span className={s.head}>
          <span className={s.title}>{title}</span>
          {number !== undefined && <span className={s.number}>{number}</span>}
        </span>
        {meta !== undefined && <span className={cx(s.meta, css.metaWrap)}>{meta}</span>}
      </span>
      {right !== undefined && <span className={s.there}>{right}</span>}
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className={s.label} aria-hidden="true">
        {label}
      </div>
      {children}
    </>
  )
}

/** A quiet line of repositories and their branches, the changed ones standing out. */
function RepoBits({ repositories, picks }: { repositories: readonly Repository[]; picks: Picks }) {
  return (
    <span className={css.bits}>
      {repositories.map((repository, index) => {
        const changed = picks[repository.id] !== undefined
        return (
          <span key={repository.id} className={cx(css.bit, changed && css.bitChanged)}>
            {index > 0 && <span className={css.sep}> · </span>}
            <span className={css.bitName}>{repository.name}</span>{' '}
            <span className={cx(s.mono, css.bitBranch)}>{labelOf(placeOf(repository, picks))}</span>
          </span>
        )
      })}
    </span>
  )
}

/** The branches and pull requests the words find, a repository's own left out of its branch list. */
function matches(words: string, text: string) {
  return words
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.toLowerCase().includes(word))
}

const branchesOf = (repository: Repository, words: string) =>
  repository.branches.filter(
    (branch) => branch !== repository.defaultBranch && (matches(words, repository.name) || matches(words, `${repository.name} ${branch}`)),
  )

const pullsOf = (repository: Repository, words: string) =>
  repository.pullRequests.filter(
    (pull) => matches(words, repository.name) || matches(words, `${repository.name} ${pull.title} ${pull.branch} ${pull.author}`),
  )

/** A — one flat list, every place naming its repository. */
function Flat({
  repositories,
  tasks,
  picks,
  task,
  hostConnected,
  hostName,
  single,
  onPickBranch,
  onPickPull,
  onPickTask,
  onReset,
  onConnect,
}: {
  repositories: readonly Repository[]
  tasks: readonly Task[]
  picks: Picks
  task: Task | null
  hostConnected: boolean
  hostName: string
  single: boolean
  onPickBranch: (repository: Repository, branch: string) => void
  onPickPull: (repository: Repository, pull: PullRequest) => void
  onPickTask: (task: Task) => void
  onReset: () => void
  onConnect: () => void
}) {
  const [words, setWords] = useState('')
  const changed = changedOf(repositories, picks)
  const shownTasks = tasks.filter((one) => matches(words, one.title) || one.repositories.some((name) => matches(words, name)))
  const rows = repositories.flatMap((repository) => branchesOf(repository, words).map((branch) => ({ repository, branch })))
  const pulls = repositories.flatMap((repository) =>
    (hostConnected ? pullsOf(repository, words) : []).map((pull) => ({ repository, pull })),
  )
  return (
    <div className={s.picker}>
      <Field words={words} onWords={setWords} />
      <div className={s.results}>
        <Row
          checked={task === null && changed.length === 0}
          glyph="branch"
          title={single ? <span className={s.mono}>{repositories[0]!.defaultBranch}</span> : 'Default branches'}
          number={single ? undefined : `${repositories.length} repositories`}
          meta={single ? 'Its default branch' : <RepoBits repositories={repositories} picks={picks} />}
          right={changed.length > 0 ? `${changed.length} changed` : undefined}
          onClick={onReset}
        />
        {shownTasks.length > 0 && (
          <Group label="Tasks">
            {shownTasks.map((one) => (
              <Row
                key={one.id}
                checked={task?.id === one.id}
                glyph="agents"
                title={one.title}
                meta={single ? 'its worktree' : `${one.repositories.join(' · ')} · its worktree`}
                onClick={() => onPickTask(one)}
              />
            ))}
          </Group>
        )}
        {pulls.length > 0 && (
          <Group label="Pull requests">
            {pulls.map(({ repository, pull }) => (
              <Row
                key={`${repository.id}:${pull.number}`}
                checked={picks[repository.id]?.kind === 'pull' && picks[repository.id]?.number === pull.number}
                glyph="pr"
                title={pull.title}
                number={`!${pull.number}`}
                meta={
                  <>
                    {!single && (
                      <>
                        <span className={css.repoTag}>{repository.name}</span> ·{' '}
                      </>
                    )}
                    <span className={s.mono}>{pull.branch}</span> · @{pull.author}
                    {pull.draft === true ? ' · Draft' : ''}
                  </>
                }
                onClick={() => onPickPull(repository, pull)}
              />
            ))}
          </Group>
        )}
        {rows.length > 0 && (
          <Group label="Branches">
            {rows.map(({ repository, branch }) => (
              <Row
                key={`${repository.id}:${branch}`}
                checked={picks[repository.id]?.kind === 'branch' && picks[repository.id]?.branch === branch}
                glyph="branch"
                title={<span className={s.mono}>{branch}</span>}
                meta={
                  repository.runnable === null ? (
                    'nothing to run'
                  ) : (
                    <>
                      {!single && (
                        <>
                          <span className={css.repoTag}>{repository.name}</span> ·{' '}
                        </>
                      )}
                      runs <span className={s.mono}>{repository.runnable.command}</span>
                    </>
                  )
                }
                onClick={() => onPickBranch(repository, branch)}
              />
            ))}
          </Group>
        )}
        {rows.length === 0 && pulls.length === 0 && shownTasks.length === 0 && <p className={s.quiet}>Nothing matches “{words}”.</p>}
      </div>
      <Foot hostConnected={hostConnected} hostName={hostName} task={task} onConnect={onConnect} />
    </div>
  )
}

/** B — a section per repository, each with its default, branches and pull requests. */
function Grouped({
  repositories,
  tasks,
  picks,
  task,
  hostConnected,
  hostName,
  onPickBranch,
  onPickPull,
  onPickTask,
  onConnect,
}: {
  repositories: readonly Repository[]
  tasks: readonly Task[]
  picks: Picks
  task: Task | null
  hostConnected: boolean
  hostName: string
  onPickBranch: (repository: Repository, branch: string) => void
  onPickPull: (repository: Repository, pull: PullRequest) => void
  onPickTask: (task: Task) => void
  onConnect: () => void
}) {
  const [words, setWords] = useState('')
  const chip = chipOf(repositories, picks, task, 'B')
  const shownTasks = tasks.filter((one) => matches(words, one.title) || one.repositories.some((name) => matches(words, name)))
  return (
    <div className={cx(s.picker, css.tallPicker)}>
      <div className={css.summary}>
        <span className={cx(css.summaryWords, chip.mono && s.mono)}>{chip.label}</span>
        <span className={css.summaryQuiet}>One repository can move while the rest stay on their defaults.</span>
      </div>
      <Field words={words} onWords={setWords} />
      <div className={s.results}>
        {shownTasks.length > 0 && (
          <Group label="Tasks">
            {shownTasks.map((one) => (
              <Row
                key={one.id}
                checked={task?.id === one.id}
                glyph="agents"
                title={one.title}
                meta={<>{one.repositories.join(' · ')} · its worktree</>}
                onClick={() => onPickTask(one)}
              />
            ))}
          </Group>
        )}
        {repositories.map((repository) => {
          const changed = picks[repository.id] !== undefined
          const branches = branchesOf(repository, words)
          const pulls = hostConnected ? pullsOf(repository, words) : []
          const itself = matches(words, repository.name)
          if (words.trim() !== '' && !itself && branches.length === 0 && pulls.length === 0) return null
          return (
            <div key={repository.id} className={css.repoGroup}>
              <div className={css.repoHead}>
                <BrandMark brand={Brand.GitLab} size={12} />
                <span className={css.repoHeadName}>{repository.name}</span>
                <span className={css.repoHeadDefault}>
                  default <span className={s.mono}>{repository.defaultBranch}</span>
                </span>
                <span className={css.grow} />
                <span className={cx(css.repoHeadNow, changed && css.now)}>{labelOf(placeOf(repository, picks))}</span>
              </div>
              <Row
                checked={!changed}
                glyph="branch"
                title={<span className={s.mono}>{repository.defaultBranch}</span>}
                meta={
                  <>
                    Default
                    {repository.runnable !== null && (
                      <>
                        {' '}
                        · runs <span className={s.mono}>{repository.runnable.command}</span>
                      </>
                    )}
                  </>
                }
                onClick={() => onPickBranch(repository, repository.defaultBranch)}
              />
              {pulls.map((pull) => (
                <Row
                  key={`${repository.id}:${pull.number}`}
                  checked={picks[repository.id]?.kind === 'pull' && picks[repository.id]?.number === pull.number}
                  glyph="pr"
                  title={pull.title}
                  number={`!${pull.number}`}
                  meta={
                    <>
                      <span className={s.mono}>{pull.branch}</span> · @{pull.author}
                      {pull.draft === true ? ' · Draft' : ''}
                    </>
                  }
                  onClick={() => onPickPull(repository, pull)}
                />
              ))}
              {branches.map((branch) => (
                <Row
                  key={`${repository.id}:${branch}`}
                  checked={picks[repository.id]?.kind === 'branch' && picks[repository.id]?.branch === branch}
                  glyph="branch"
                  title={<span className={s.mono}>{branch}</span>}
                  meta={
                    repository.runnable === null ? (
                      'nothing to run'
                    ) : (
                      <>
                        runs <span className={s.mono}>{repository.runnable.command}</span>
                      </>
                    )
                  }
                  onClick={() => onPickBranch(repository, branch)}
                />
              ))}
            </div>
          )
        })}
        {repositories.every((repository) => {
          const branches = branchesOf(repository, words)
          const pulls = hostConnected ? pullsOf(repository, words) : []
          return !matches(words, repository.name) && branches.length === 0 && pulls.length === 0
        }) &&
          shownTasks.length === 0 && <p className={s.quiet}>Nothing matches “{words}”.</p>}
      </div>
      <Foot hostConnected={hostConnected} hostName={hostName} task={task} onConnect={onConnect} />
    </div>
  )
}

/** C — a compact board: each repository at the left, what Run will start at the right. */
function Board({
  repositories,
  tasks,
  picks,
  task,
  hostConnected,
  hostName,
  onPickBranch,
  onPickPull,
  onPickTask,
  onReset,
  onConnect,
}: {
  repositories: readonly Repository[]
  tasks: readonly Task[]
  picks: Picks
  task: Task | null
  hostConnected: boolean
  hostName: string
  onPickBranch: (repository: Repository, branch: string) => void
  onPickPull: (repository: Repository, pull: PullRequest) => void
  onPickTask: (task: Task) => void
  onReset: () => void
  onConnect: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(() => changedOf(repositories, picks)[0]?.id ?? null)
  const [words, setWords] = useState('')
  const chip = chipOf(repositories, picks, task, 'C')
  return (
    <div className={cx(s.picker, css.boardPicker)}>
      <div className={css.boardTop}>
        <div className={css.summary}>
          <span className={cx(css.summaryWords, chip.mono && s.mono)}>{chip.label}</span>
          <span className={css.summaryQuiet}>Each run makes a fresh copy of its repository’s branch.</span>
        </div>
      </div>
      <Field words={words} onWords={setWords} />
      <LinkButton className={css.reset} onClick={onReset}>
        All on defaults
      </LinkButton>
      <div className={css.columns}>
        <div className={css.reposCol}>
          <div className={s.label} aria-hidden="true">
            Tasks
          </div>
          {task !== null && (
            <Row
              checked
              glyph="agents"
              title={task.title}
              meta={`${task.repositories.join(' · ')} · its worktree`}
              onClick={() => onPickTask(task)}
            />
          )}
          {tasks
            .filter((one) => one.id !== task?.id && (matches(words, one.title) || one.repositories.some((name) => matches(words, name))))
            .slice(0, 2)
            .map((one) => (
              <Row
                key={one.id}
                checked={false}
                glyph="agents"
                title={one.title}
                meta={`${one.repositories.join(' · ')} · its worktree`}
                onClick={() => onPickTask(one)}
              />
            ))}
          <div className={cx(s.label, css.boardLabel)} aria-hidden="true">
            Repositories
          </div>
          {repositories.map((repository) => {
            const changed = picks[repository.id] !== undefined
            const openHere = expanded === repository.id
            const branches = branchesOf(repository, words)
            const pulls = hostConnected ? pullsOf(repository, words) : []
            return (
              <div key={repository.id} className={css.repoBlock}>
                <button
                  type="button"
                  className={cx(css.repoItem, openHere && css.repoItemOpen)}
                  aria-expanded={openHere}
                  onClick={() => setExpanded(openHere ? null : repository.id)}
                >
                  <BrandMark brand={Brand.GitLab} size={12} />
                  <span className={css.repoItemMain}>
                    <span className={css.repoItemName}>{repository.name}</span>
                    <span className={cx(s.mono, css.repoItemBranch, changed && css.now)}>{labelOf(placeOf(repository, picks))}</span>
                  </span>
                  <span className={css.repoItemRuns}>{repository.runnable?.command ?? 'nothing to run'}</span>
                  <Icon name={openHere ? 'chevronU' : 'chevronD'} size={11} className={css.chevron} />
                </button>
                {openHere && (
                  <div className={css.choices}>
                    <Row
                      checked={!changed}
                      glyph="branch"
                      title={<span className={s.mono}>{repository.defaultBranch}</span>}
                      meta="Default"
                      onClick={() => onPickBranch(repository, repository.defaultBranch)}
                    />
                    {pulls.map((pull) => (
                      <Row
                        key={`${repository.id}:${pull.number}`}
                        checked={picks[repository.id]?.kind === 'pull' && picks[repository.id]?.number === pull.number}
                        glyph="pr"
                        title={pull.title}
                        number={`!${pull.number}`}
                        meta={
                          <>
                            <span className={s.mono}>{pull.branch}</span> · @{pull.author}
                          </>
                        }
                        onClick={() => onPickPull(repository, pull)}
                      />
                    ))}
                    {branches.map((branch) => (
                      <Row
                        key={`${repository.id}:${branch}`}
                        checked={picks[repository.id]?.kind === 'branch' && picks[repository.id]?.branch === branch}
                        glyph="branch"
                        title={<span className={s.mono}>{branch}</span>}
                        onClick={() => onPickBranch(repository, branch)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className={css.runsCol}>
          <div className={s.label} aria-hidden="true">
            Where each run starts
          </div>
          {repositories.map((repository) => {
            const changed = picks[repository.id] !== undefined
            return (
              <div key={repository.id} className={css.runRow}>
                <span className={css.runRepo}>{repository.name}</span>
                <span className={cx(s.mono, css.runBranch, changed && css.now)}>{labelOf(placeOf(repository, picks))}</span>
                <span className={css.runCommand}>{repository.runnable?.command ?? 'nothing to run'}</span>
                <span className={css.runWhere}>
                  {repository.runnable === null
                    ? ''
                    : repository.runnable.port === null
                      ? 'a window'
                      : `localhost:${repository.runnable.port}`}
                </span>
              </div>
            )
          })}
          <p className={css.runNote}>
            {task === null
              ? 'Each run copies its repository’s branch into a folder of its own. Nothing moves in the checkouts.'
              : 'The task’s worktree has a copy of each repository it touches; nothing runs on its branch elsewhere.'}
          </p>
        </div>
      </div>
      <Foot hostConnected={hostConnected} hostName={hostName} task={task} onConnect={onConnect} />
    </div>
  )
}
