import type { ReactNode } from 'react'

import type { Service } from '@althar/contracts'
import {
  BrandMark,
  Button,
  Icon,
  LinkButton,
  Menu,
  MenuItem,
  NewRepositoryFields,
  Select,
  SetupConnectRow,
  SetupDrop,
  SetupFixed,
  SetupPick,
  SetupPicks,
  SetupRepositories,
  SetupSection,
  SetupSource,
  SetupWays,
  SetupZone,
} from '@althar/ui'

import { device } from '../../shared/device'
import { ConnectFlow } from '../connections/ConnectFlow'
import { useConnect } from '../connections/useConnect'
import type { Draft, DraftFolder } from './draft'
import s from './NewProject.module.css'
import type { SetupActions, SetupModel } from './useSetup'

/*
 * A new project's setup, beside its name: where its code comes from, three
 * ways side by side, and under them the one chosen; where its code lives;
 * and where its issues go. A host or tracker not connected yet connects in
 * place, where it was asked for, its walk where the list or the choices
 * were, and back to them once it ends.
 */

export const text = {
  code: 'Where its code lives',
  issues: 'Issues',
  here: (home: string) => `Only on ${home}`,
  hereNote: 'Finished work merges into main here',
  newOn: (thing: string, host: string) => `A new ${thing} on ${host}`,
  thenNew: (thing: string) => `Then a new ${thing} there`,
  none: 'None for now',
  noneNote: 'Link a tracker any time in its settings',
  orOthers: (names: readonly string[]) => (names.length === 0 ? '' : `Or ${names.join(', or ')}`),
  team: 'Where on it',
  readingTeams: 'Reading…',
  tryAgain: 'Try again',
  ownersFailed: (host: string) => `Where it can go on ${host} couldn’t be read.`,
  back: 'Back',
  into: (where: string) => `Into ${where}`,
  chooseWhere: 'Choose where it goes',
  change: 'Change',
  cloneWhere: 'Where it’s cloned to',
  folder: {
    empty: 'Empty. Git starts in it on main, with a first commit.',
    none: 'No git yet. It starts on main, with what’s in it as the first commit.',
    unborn: 'Git, with no commits yet. What’s in it becomes the first, on its branch.',
    ready: (remote: string | null) => (remote === null ? `Git, with no remote: finished work merges here.` : null),
    project: (name: string) => `It’s ${name} already.`,
    open: (name: string) => `Open ${name}`,
  },
  fresh: 'A new repository, on main',
  nameFirst: 'Name it first',
  chooseFresh: 'Choose where it goes…',
  /** On another computer's home, where it goes is the home's usual place. */
  freshOn: (home: string) => `Start it on ${home}`,
  connect: 'Connect',
  connectTracker: 'Connect a tracker',
  add: 'Add a folder…',
  remove: (name: string) => `Leave out ${name}`,
}

/** A service's walk in, in place, with a way back to what was there before it. */
export function ConnectInPlace({ service, onDone: ended }: { service: Service; onDone: () => void }) {
  // Ended, the walk goes, and focus with it: back to the way chosen, so the keyboard still has the page.
  const onDone = () => {
    ended()
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-way][aria-checked="true"]')?.focus())
  }
  const flow = useConnect({ service, onClose: onDone })
  return (
    <div className={s.inPlace}>
      <ConnectFlow model={flow} compact align="start" />
      <LinkButton
        className={s.inPlaceBack}
        onClick={() => {
          if (!flow.back()) onDone()
        }}
      >
        {text.back}
      </LinkButton>
    </div>
  )
}

/** A folder chosen, with what git it has, or what stops it, and what puts that right. */
function FolderCard({
  folder,
  onRemove,
  onOpen,
  several,
}: {
  folder: DraftFolder
  onRemove: () => void
  onOpen: (projectId: string) => void
  several: boolean
}) {
  const project = folder.project
  const line: { tone: 'fine' | 'bad'; icon: 'branch' | 'lock' | 'folder'; said: ReactNode } | undefined =
    project !== null
      ? {
          tone: 'bad',
          icon: 'folder',
          said: (
            <>
              {text.folder.project(project.name)}{' '}
              <LinkButton onClick={() => onOpen(project.id)}>{text.folder.open(project.name)}</LinkButton>
            </>
          ),
        }
      : folder.git === 'none'
        ? { tone: 'fine', icon: 'branch', said: folder.empty ? text.folder.empty : text.folder.none }
        : folder.git === 'unborn'
          ? { tone: 'fine', icon: 'branch', said: text.folder.unborn }
          : !several && folder.remote === null
            ? { tone: 'fine', icon: 'branch', said: text.folder.ready(null) }
            : undefined
  return (
    <SetupSource
      mark={<Icon name="folder" size={18} />}
      name={folder.name}
      where={folder.where}
      {...(line === undefined ? {} : { line })}
      onChange={onRemove}
      text={{ change: several ? 'Leave out' : 'Change' }}
    />
  )
}

export function SetupSide({
  setup,
  draft,
  creating,
  onChoose,
  onLeaveOut,
  onReplace,
  onStartFresh,
  onChooseCloneInto,
  onOpenProject,
  dropping,
  only,
  homeName,
  folderWay,
  minHeight = 196,
}: {
  setup: SetupModel & SetupActions
  draft: Draft
  creating: boolean
  onChoose: () => void
  onLeaveOut: (path: string) => void
  onReplace: (path: string) => void
  onStartFresh: () => void
  /** Asks where a clone goes; without it, it goes in the usual place. */
  onChooseCloneInto?: () => void
  onOpenProject: (projectId: string) => void
  /** A folder is being dragged over the page. */
  dropping: boolean
  /** Only where its code comes from, as the first run's step for it is: where it lives and its issues are steps of their own. */
  only?: 'source'
  /**
   * Made on another computer's home: its name. Its code goes where that home
   * keeps code, so there's no choosing where; its folders are those it
   * found, in `folderWay`.
   */
  homeName?: string
  /** In place of the folders chosen: the consumer's own, as the first run's list of what this computer has. */
  folderWay?: ReactNode
  minHeight?: number
}) {
  const height = minHeight
  const folders = draft.folders.filter((folder) => folder.came === undefined)
  const madeNew = draft.folders.find((folder) => folder.came === 'new')
  const clone = setup.clone
  const cloned = draft.folders.find((folder) => folder.came === 'clone')

  const body = (() => {
    if (setup.way === 'clone') {
      if (clone !== null && (creating || cloned !== undefined)) {
        const parts = clone.remote.split('/')
        const name = parts.at(-1) ?? clone.remote
        return (
          <SetupZone>
            <SetupSource
              mark={clone.brand === null ? <Icon name="download" size={18} /> : <BrandMark brand={clone.brand} size={22} />}
              owner={parts.slice(0, -1).join('/')}
              name={name}
              where={cloned?.where ?? clone.here?.where ?? (clone.where === null ? clone.hostName : `${clone.where}/${name}`)}
              filling={creating && setup.statuses.source === 'doing'}
            />
          </SetupZone>
        )
      }
      return (
        <>
          <SetupRepositories
            hosts={setup.hosts}
            repositories={setup.repositories}
            failed={setup.failed}
            onRetry={setup.retry}
            query={draft.query}
            onQuery={setup.onQuery}
            pasted={setup.pasted}
            chosen={setup.chosen}
            onChoose={setup.choose}
            onConnect={(host) => setup.connect(host as Service)}
            connecting={
              setup.connecting !== null && ['github', 'gitlab', 'bitbucket'].includes(setup.connecting) ? (
                <ConnectInPlace service={setup.connecting} onDone={setup.endConnect} />
              ) : null
            }
            height={height}
          />
          {clone !== null && clone.here === null && (
            <p className={s.cloneWhere}>
              {clone.where === null ? (
                onChooseCloneInto !== undefined && <LinkButton onClick={onChooseCloneInto}>{text.chooseWhere}</LinkButton>
              ) : (
                <>
                  <span>{text.into(clone.where)}</span>
                  {onChooseCloneInto !== undefined && (
                    <LinkButton onClick={onChooseCloneInto} aria-label={`${text.change}: ${text.cloneWhere}`}>
                      {text.change}
                    </LinkButton>
                  )}
                </>
              )}
            </p>
          )}
        </>
      )
    }
    if (setup.way === 'new') {
      const fresh = draft.fresh
      if (fresh === null && madeNew === undefined)
        return (
          <SetupZone empty>
            <Icon name="create" size={18} />
            <Button size="small" icon="plus" onClick={onStartFresh} disabled={draft.name.trim() === ''}>
              {draft.name.trim() === '' ? text.nameFirst : homeName === undefined ? text.chooseFresh : text.freshOn(homeName)}
            </Button>
          </SetupZone>
        )
      const shown = madeNew ?? fresh
      return (
        <SetupZone>
          <SetupSource
            mark={<Icon name="create" size={18} />}
            name={shown?.name ?? ''}
            where={shown?.where ?? ''}
            facts={text.fresh}
            {...(madeNew === undefined && !creating && homeName === undefined ? { onChange: onStartFresh } : {})}
          />
        </SetupZone>
      )
    }
    if (folderWay !== undefined) return folderWay
    if (folders.length === 0 && draft.reading.length === 0) return <SetupDrop onChoose={onChoose} over={dropping} />
    return (
      <SetupZone>
        <div className={s.folders}>
          {folders.map((folder) => (
            <FolderCard
              key={folder.path}
              folder={folder}
              several={folders.length > 1}
              onRemove={() => (folders.length > 1 ? onLeaveOut(folder.path) : onReplace(folder.path))}
              onOpen={onOpenProject}
            />
          ))}
          {draft.reading.map((reading) => (
            <SetupSource
              key={reading.key}
              mark={<Icon name="folder" size={18} />}
              name={reading.name ?? '…'}
              where={reading.where ?? ''}
              filling
            />
          ))}
          {folders.length > 0 && (
            <Button size="small" variant="quiet" icon="plus" onClick={onChoose} className={s.addFolder}>
              {text.add}
            </Button>
          )}
        </div>
      </SetupZone>
    )
  })()

  const home = setup.home
  const issues = setup.issues
  return (
    <fieldset className={s.fieldset} disabled={creating}>
      <div className={s.stack}>
        <SetupWays way={setup.way} onWay={setup.onWay} hosts={setup.hosts} minHeight={height + 40}>
          {body}
        </SetupWays>
        {only === undefined && home.kind !== 'none' && !(home.kind === 'picks' && home.connected.length + home.away.length === 0) && (
          <SetupSection title={text.code} status={setup.statuses.home}>
            {home.kind === 'fixed' ? (
              <SetupFixed mark={home.brand === null ? <Icon name="download" size={14} /> : <BrandMark brand={home.brand} size={14} />}>
                {home.said}
              </SetupFixed>
            ) : setup.connecting !== null && home.away.some((one) => one.service === setup.connecting) ? (
              <ConnectInPlace service={setup.connecting} onDone={setup.endConnect} />
            ) : (
              <SetupPicks label={text.code}>
                {home.connected.map((host) => (
                  <SetupPick
                    key={host.id}
                    checked={home.value === host.id}
                    onChoose={() => setup.onHome(host.id)}
                    mark={<BrandMark brand={host.brand} size={16} />}
                    title={text.newOn(host.thing, host.name)}
                    {...(home.value === host.id ? {} : { note: `${home.owner ?? '…'}/${home.name}` })}
                  >
                    <NewRepositoryFields
                      owners={home.owners}
                      owner={home.owner}
                      onOwner={setup.onOwner}
                      name={home.name}
                      onName={setup.onRepoName}
                      visibility={home.private ? 'private' : 'public'}
                      onVisibility={(next) => setup.onPrivate(next === 'private')}
                      {...(draft.homeError !== null
                        ? { error: draft.homeError }
                        : home.ownersFailed
                          ? {
                              error: (
                                <>
                                  {text.ownersFailed(host.name)}{' '}
                                  <Button size="small" variant="quiet" onClick={home.retryOwners}>
                                    {text.tryAgain}
                                  </Button>
                                </>
                              ),
                            }
                          : {})}
                    />
                  </SetupPick>
                ))}
                {home.away.map((host) => (
                  <SetupConnectRow
                    key={host.service}
                    brand={host.brand}
                    title={host.name}
                    note={text.thenNew(host.thing)}
                    onConnect={() => setup.connect(host.service)}
                  />
                ))}
                <SetupPick
                  checked={home.value === 'here'}
                  onChoose={() => setup.onHome('here')}
                  mark={<Icon name="folder" size={15} />}
                  title={text.here(homeName ?? device.this)}
                  note={text.hereNote}
                />
              </SetupPicks>
            )}
          </SetupSection>
        )}
        {only === undefined && (issues.host !== null || issues.trackers.length + issues.away.length > 0) && (
          <SetupSection title={text.issues} status={setup.statuses.issues}>
            {setup.connecting !== null && issues.away.some((one) => one.service === setup.connecting) ? (
              <ConnectInPlace service={setup.connecting} onDone={setup.endConnect} />
            ) : (
              <SetupPicks label={text.issues}>
                {issues.host !== null && (
                  <SetupPick
                    checked={issues.value === 'host'}
                    onChoose={() => setup.onIssues('host')}
                    mark={<BrandMark brand={issues.host.brand} size={16} />}
                    title={issues.host.name}
                    note={`On ${issues.host.where}`}
                  />
                )}
                {issues.trackers.map((tracker) => (
                  <SetupPick
                    key={tracker.id}
                    checked={issues.value === tracker.id}
                    onChoose={() => setup.onIssues(tracker.id)}
                    mark={<BrandMark brand={tracker.brand} size={16} />}
                    title={tracker.name}
                  >
                    <Select
                      variant="filled"
                      label={text.team}
                      width={260}
                      value={issues.container ?? ''}
                      onChange={setup.onContainer}
                      disabled={issues.containers === null}
                      options={
                        issues.containers === null
                          ? [{ value: '', label: text.readingTeams }]
                          : issues.containers.map((one) => ({ value: one.id, label: one.name }))
                      }
                    />
                  </SetupPick>
                ))}
                {issues.away[0] !== undefined && (
                  <SetupConnectRow
                    brand={issues.away[0].brand}
                    title={issues.away[0].name}
                    note={text.orOthers(issues.away.slice(1).map((one) => one.name))}
                    action={
                      <Menu
                        label={text.connectTracker}
                        trigger={
                          <Button size="small" trailingIcon="chevronD">
                            {text.connect}
                          </Button>
                        }
                      >
                        {issues.away.map((one) => (
                          <MenuItem
                            key={one.service}
                            lead={<BrandMark brand={one.brand} size={14} />}
                            onSelect={() => setup.connect(one.service)}
                          >
                            {one.name}
                          </MenuItem>
                        ))}
                      </Menu>
                    }
                  />
                )}
                <SetupPick
                  checked={issues.value === 'none'}
                  onChoose={() => setup.onIssues('none')}
                  mark={<Icon name="close" size={14} />}
                  title={text.none}
                  note={text.noneNote}
                />
              </SetupPicks>
            )}
          </SetupSection>
        )}
      </div>
    </fieldset>
  )
}
