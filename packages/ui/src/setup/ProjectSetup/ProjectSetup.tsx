import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { device } from '../../foundations/device'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { Problem } from '../../primitives/Problem/Problem'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Select } from '../../primitives/Select/Select'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './ProjectSetup.module.css'

/*
 * A project set up where it starts, in pieces a screen lays out: where its
 * code comes from, three ways side by side (a clone from a code host, a
 * folder on this computer, or a new repository), and under them the one
 * chosen, in room that stays the same whichever it is; where its code lives,
 * a new repository on a connected host or only this computer; and where its
 * issues go. Each is a section, with how it is going once the project is
 * being made: waiting, under way, done.
 *
 * Your repositories on the hosts connected are found as they are typed, or
 * by a pasted URL, those named like the project first and lit in its colour.
 * A host not connected yet connects in place, where it was asked for: the
 * screen gives the walk (`connecting`), in the room the list had.
 */

/** Which way its code comes in. */
export type SetupWay = 'clone' | 'folder' | 'new'

/** How a part of the setup is going once the project is being made. */
export type SetupStatus = 'idle' | 'waiting' | 'doing' | 'done'

/** A code host Althar works with, connected or not. */
export interface SetupHost {
  readonly id: string
  readonly name: string
  readonly brand: Brand
  /** What it calls a repository: a project, on GitLab. */
  readonly thing: string
  readonly connected: boolean
  /** How it connects, said where it isn't yet: in the browser, or with a token. */
  readonly how: string
}

/** A repository on a connected host, to clone, or to add where it is on this computer already. */
export interface HostedRepository {
  readonly id: string
  /** Its host, by `SetupHost.id`. */
  readonly host: string
  /** Who it belongs to, as the host names them, nested groups and all: northwind/platform. */
  readonly owner: string
  readonly name: string
  readonly description: string | null
  readonly private: boolean
  /** When it was last pushed to, said: yesterday. */
  readonly pushed: string | null
  /** Named like the project. */
  readonly like: boolean
  /** Where it is on this computer already, when it is: added, not cloned. */
  readonly here: string | null
  /** Where else it is, said in place of when it was pushed: one of your projects on another computer. */
  readonly from?: string
  /** Its host's mark, where its host isn't one of those offered. */
  readonly brand?: Brand
}

export interface ProjectSetupText {
  ways: string
  clone: string
  cloneFrom: (hosts: string) => string
  /** Where no host is offered: a clone by its address alone. */
  cloneAnywhere: string
  folder: string
  folderNote: string
  fresh: string
  freshNote: string
  find: string
  findUnconnected: string
  which: string
  all: string
  connect: string
  connectHost: string
  like: string
  cloneRow: string
  add: string
  chosen: string
  hereNote: (where: string) => string
  none: (typed: string) => string
  empty: string
  reading: string
  readFailed: (host: string) => string
  tryAgain: string
  privately: string
  drop: string
  choose: string
  change: string
  owner: string
  name: string
  visibility: string
  private: string
  public: string
  readingOwners: string
}

/** "GitHub, GitLab or Bitbucket". */
export const listOr = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

export const projectSetupText: ProjectSetupText = {
  ways: 'Where its code comes from',
  clone: 'Clone',
  cloneFrom: (hosts) => `From ${hosts}`,
  cloneAnywhere: 'From its address',
  folder: 'A folder',
  folderNote: `On ${device.this}`,
  fresh: 'Start empty',
  freshNote: 'A new repository',
  find: 'Find a repository, or paste its URL',
  findUnconnected: 'Paste a repository’s URL',
  which: 'Which host',
  all: 'All',
  connect: 'Connect',
  connectHost: 'Connect a host',
  like: 'Named like the project',
  cloneRow: 'Clone',
  add: 'Add',
  chosen: 'Chosen',
  hereNote: (where) => `At ${where}`,
  none: (typed) => `None match “${typed}”.`,
  empty: 'Nothing on these hosts yet.',
  reading: 'Reading your repositories…',
  readFailed: (host) => `${host}’s repositories couldn’t be read.`,
  tryAgain: 'Try again',
  privately: 'Private',
  drop: 'Drop a folder here',
  choose: 'Choose a folder…',
  change: 'Change',
  owner: 'Owner',
  name: 'Name',
  visibility: 'Who can see it',
  private: 'Private',
  public: 'Public',
  readingOwners: 'Reading…',
}

/* ---- Sections ---- */

/** A part of the setup, titled, with how it is going once the project is being made. */
export function SetupSection({ title, status = 'idle', children }: { title: string; status?: SetupStatus; children: ReactNode }) {
  const id = useId()
  return (
    <section className={s.section} aria-labelledby={id} aria-busy={status === 'doing' || undefined}>
      <header className={s.sectionHead}>
        <h3 id={id} className={s.sectionTitle}>
          {title}
        </h3>
        <SetupStatusMark status={status} />
      </header>
      {children}
    </section>
  )
}

function SetupStatusMark({ status }: { status: SetupStatus }) {
  if (status === 'doing') return <Spinner size="small" />
  if (status === 'done')
    return (
      <span className={s.tick} role="img" aria-label="Done">
        <Icon name="check" size={10} />
      </span>
    )
  return null
}

/* ---- Picks: one of a few, as rows on one sheet ---- */

/** A few choices as rows on one sheet, one of them chosen; the chosen one opens to what it needs. */
export function SetupPicks({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className={s.picks}>
      {children}
    </div>
  )
}

/** One of a few: its mark, what it is and a note; chosen, what it needs under it. */
export function SetupPick({
  checked,
  onChoose,
  mark,
  title,
  note,
  disabled,
  children,
}: {
  checked: boolean
  onChoose: () => void
  mark: ReactNode
  title: string
  note?: ReactNode
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className={cx(s.pick, checked && s.pickOn)}>
      <button type="button" role="radio" aria-checked={checked} className={s.pickHead} onClick={onChoose} disabled={disabled}>
        <span className={s.dot} aria-hidden="true" />
        <span className={s.pickMark} aria-hidden="true">
          {mark}
        </span>
        <span className={s.pickTitle}>{title}</span>
        {note !== undefined && <span className={s.pickNote}>{note}</span>}
      </button>
      {checked && children !== undefined && <div className={s.pickMore}>{children}</div>}
    </div>
  )
}

/** Something it could use, not connected yet: where a pick would be, with Connect. */
export function SetupConnectRow({
  brand,
  title,
  note,
  onConnect,
  connect = projectSetupText.connect,
  action,
}: {
  brand: Brand
  title: string
  note: string
  onConnect?: () => void
  connect?: string
  /** In place of Connect: a menu of what to connect, say. */
  action?: ReactNode
}) {
  return (
    <div className={s.connectRow}>
      <span className={s.dotless} aria-hidden="true" />
      <span className={cx(s.pickMark, s.away)} aria-hidden="true">
        <BrandMark brand={brand} size={16} />
      </span>
      <span className={s.pickTitle}>{title}</span>
      <span className={s.pickNote}>{note}</span>
      {action ?? (
        <Button size="small" onClick={onConnect} aria-label={`${connect} ${title}`}>
          {connect}
        </Button>
      )}
    </div>
  )
}

/** A fact where a choice would be, as for a clone, whose code lives where it came from. */
export function SetupFixed({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <p className={s.fixed}>
      <span className={s.fixedMark} aria-hidden="true">
        {mark}
      </span>
      <span>{children}</span>
    </p>
  )
}

/* ---- The three ways in ---- */

/**
 * Clone, a folder or Start empty, side by side, and under them the one
 * chosen, in room that stays the same whichever it is (`minHeight`).
 */
export function SetupWays({
  way,
  onWay,
  hosts,
  minHeight,
  children,
  text,
}: {
  way: SetupWay
  onWay: (way: SetupWay) => void
  /** The hosts a clone comes from: those connected, else all Althar works with. */
  hosts: readonly SetupHost[]
  minHeight: number
  children: ReactNode
  text?: Partial<ProjectSetupText>
}) {
  const t = { ...projectSetupText, ...text }
  const from = hosts.some((host) => host.connected) ? hosts.filter((host) => host.connected) : hosts
  const ways: Array<{ id: SetupWay; title: string; note: string; art: ReactNode }> = [
    {
      id: 'clone',
      title: t.clone,
      note: from.length === 0 ? t.cloneAnywhere : t.cloneFrom(listOr(from.map((host) => host.name))),
      art: (
        <span className={s.wayMarks}>
          {hosts.map((host) => (
            <BrandMark key={host.id} brand={host.brand} size={20} />
          ))}
        </span>
      ),
    },
    { id: 'folder', title: t.folder, note: t.folderNote, art: <Icon name="folder" size={22} /> },
    { id: 'new', title: t.fresh, note: t.freshNote, art: <Icon name="create" size={22} /> },
  ]
  const choose = (event: KeyboardEvent<HTMLDivElement>) => {
    // A radio group's arrows move the choice, as a native one's do.
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const step = keys[event.key]
    if (step === undefined) return
    event.preventDefault()
    const at = ways.findIndex((one) => one.id === way)
    const next = ways[(at + step + ways.length) % ways.length]
    if (next === undefined) return
    onWay(next.id)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-way="${next.id}"]`)?.focus()
  }
  return (
    <div className={s.ways}>
      <div role="radiogroup" aria-label={t.ways} className={s.wayRow} onKeyDown={choose}>
        {ways.map((one) => (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={way === one.id}
            tabIndex={way === one.id ? 0 : -1}
            data-way={one.id}
            className={cx(s.way, one.id === 'clone' && s.wayClone)}
            onClick={() => onWay(one.id)}
          >
            <span className={s.wayArt} aria-hidden="true">
              {one.art}
            </span>
            <span className={s.wayTitle}>{one.title}</span>
            <span className={s.wayNote}>{one.note}</span>
          </button>
        ))}
      </div>
      <div className={s.wayBody} style={{ minHeight }}>
        {children}
      </div>
    </div>
  )
}

/** Nothing chosen yet, for a folder: where one is dropped, and the way to choose one. */
export function SetupDrop({ onChoose, over, text }: { onChoose: () => void; over?: boolean; text?: Partial<ProjectSetupText> }) {
  const t = { ...projectSetupText, ...text }
  return (
    <div className={cx(s.zone, s.zoneEmpty, over === true && s.zoneOver)}>
      <Icon name="folder" size={18} />
      <span className={s.zoneTitle}>{t.drop}</span>
      <Button size="small" icon="folder" onClick={onChoose}>
        {t.choose}
      </Button>
    </div>
  )
}

/** Room under the three ways for what the one chosen holds; `empty`, a dashed place where nothing is yet. */
export function SetupZone({ empty, children }: { empty?: boolean; children: ReactNode }) {
  return <div className={cx(s.zone, empty === true && s.zoneEmpty)}>{children}</div>
}

/* ---- What was chosen ---- */

/**
 * Where its code comes from, once chosen: the repository or folder, where
 * it is or will be, and a line saying what git is in it, or what is wrong
 * with it, with what puts it right. While it is being cloned, it fills.
 */
export function SetupSource({
  mark,
  owner,
  name,
  where,
  facts,
  line,
  onChange,
  filling,
  text,
}: {
  mark: ReactNode
  /** As its host names it, before its name: balazs/. */
  owner?: string
  name: string
  where: string
  facts?: string
  line?: { readonly tone: 'fine' | 'bad'; readonly icon: IconName; readonly said: ReactNode }
  onChange?: () => void
  /** Being cloned: it fills, in the project's colour, for as long as it takes. */
  filling?: boolean
  text?: Partial<ProjectSetupText>
}) {
  const t = { ...projectSetupText, ...text }
  return (
    <div className={cx(s.card, line !== undefined && s.cardTall)} aria-busy={filling === true || undefined}>
      <span className={s.cardMark} aria-hidden="true">
        {mark}
      </span>
      <span className={s.cardMain}>
        <span className={s.cardName} title={owner === undefined ? name : `${owner}/${name}`}>
          {owner !== undefined && <span className={s.owner}>{owner}/</span>}
          {name}
        </span>
        <span className={s.cardFacts}>
          <span className={s.mono} title={where}>
            {where}
          </span>
          {facts !== undefined && <span>{facts}</span>}
        </span>
      </span>
      {onChange !== undefined && (
        <LinkButton className={s.cardChange} onClick={onChange}>
          {t.change}
        </LinkButton>
      )}
      {line !== undefined && (
        <p className={cx(s.cardLine, line.tone === 'bad' && s.cardBad)}>
          <Icon name={line.icon} size={13} />
          <span>{line.said}</span>
        </p>
      )}
      {filling === true && <span className={s.fill} aria-hidden="true" />}
    </div>
  )
}

/* ---- Your repositories ---- */

/** Your repositories on the hosts connected, found as they are typed, those named like the project first: each chosen in a press. */
export function SetupRepositories({
  hosts,
  repositories,
  failed = [],
  onRetry,
  query,
  onQuery,
  pasted,
  chosen,
  onChoose,
  onConnect,
  connecting,
  landing,
  height,
  text,
}: {
  hosts: readonly SetupHost[]
  /** Null while they are read. */
  repositories: readonly HostedRepository[] | null
  /** The hosts whose repositories couldn't be read, by id. */
  failed?: readonly string[]
  onRetry?: () => void
  query: string
  onQuery: (query: string) => void
  /** A repository a pasted URL names: shown alone, in place of those found. */
  pasted?: HostedRepository | null
  chosen: string | null
  onChoose: (id: string) => void
  onConnect: (host: string) => void
  /** A host being connected, in place: its walk, in the room the list had. */
  connecting?: ReactNode
  /** Where the one chosen lands, said on its row in place of when it was pushed: ~/code/meridian-web. */
  landing?: string | null
  height: number
  text?: Partial<ProjectSetupText>
}) {
  const t = { ...projectSetupText, ...text }
  const [onlyPick, setOnly] = useState('all')
  const connected = hosts.filter((host) => host.connected)
  const away = hosts.filter((host) => !host.connected)
  const only = onlyPick === 'all' || connected.some((host) => host.id === onlyPick) ? onlyPick : 'all'
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const listed =
    pasted !== undefined && pasted !== null
      ? [pasted]
      : (repositories ?? []).filter(
          (one) =>
            (only === 'all' || one.host === only) &&
            words.every((word) => `${one.owner}/${one.name} ${one.description ?? ''}`.toLowerCase().includes(word)),
        )
  const shown = [...listed.filter((one) => one.like), ...listed.filter((one) => !one.like)]
  const hostOf = (id: string) => hosts.find((host) => host.id === id)
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])
  const onField = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      rows()[0]?.focus()
    } else if (event.key === 'Enter' && shown[0] !== undefined) {
      event.preventDefault()
      onChoose(shown[0].id)
    }
  }
  const onRow = (event: KeyboardEvent<HTMLButtonElement>) => {
    const all = rows()
    const at = all.indexOf(event.currentTarget)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      ;(event.key === 'ArrowDown' ? all[at + 1] : at === 0 ? field.current : all[at - 1])?.focus()
    }
  }
  const failedNames = failed.flatMap((id) => hostOf(id)?.name ?? [])
  // With no host connected, repositories listed are from elsewhere (your projects on another computer): the hosts are offered beside them.
  const listing = connected.length > 0 || (repositories ?? []).length > 0
  const body = (() => {
    if (connecting !== undefined && connecting !== null) return <div className={s.walk}>{connecting}</div>
    if (!listing && (pasted === undefined || pasted === null))
      return (
        <div className={s.connectHosts} style={{ minHeight: height }}>
          {hosts.map((host, at) => (
            <div key={host.id} className={s.connectHost}>
              <BrandMark brand={host.brand} size={26} />
              <span className={s.connectHostName}>{host.name}</span>
              <span className={s.connectHostNote}>{host.how}</span>
              <Button
                size="small"
                variant={at === 0 ? 'signal' : 'default'}
                onClick={() => onConnect(host.id)}
                aria-label={`${t.connect} ${host.name}`}
              >
                {t.connect}
              </Button>
            </div>
          ))}
        </div>
      )
    if (repositories === null && (pasted === undefined || pasted === null))
      return (
        <p className={s.reposQuiet} style={{ height }} role="status">
          <Spinner size="small" />
          {t.reading}
        </p>
      )
    if (shown.length === 0)
      return (
        <p className={s.reposQuiet} style={{ height }}>
          {query.trim() === '' ? t.empty : t.none(query.trim())}
        </p>
      )
    return (
      <ul ref={list} className={s.repoList} style={{ height }} aria-label={t.ways}>
        {shown.map((one) => {
          const host = hostOf(one.host)
          const mark = host?.brand ?? one.brand
          const on = chosen === one.id
          const act = on ? t.chosen : one.here === null ? t.cloneRow : t.add
          return (
            <li key={one.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${act} ${one.owner}/${one.name}`}
                data-row
                className={cx(s.repo, one.like && s.repoLike, on && s.repoOn)}
                onClick={() => onChoose(one.id)}
                onKeyDown={onRow}
              >
                <span className={s.repoMark} aria-hidden="true">
                  {mark !== undefined && <BrandMark brand={mark} size={20} />}
                </span>
                <span className={s.repoMain}>
                  <span className={s.repoName}>
                    <span className={s.repoPath} title={`${one.owner}/${one.name}`}>
                      <span className={s.owner}>{one.owner}/</span>
                      {one.name}
                    </span>
                    {one.private && <Icon name="lock" size={11} aria-label={t.privately} />}
                    {one.like && <span className={s.likeTag}>{t.like}</span>}
                  </span>
                  <span className={s.repoFacts}>
                    {one.description !== null && one.description !== '' && (
                      <span className={s.about} title={one.description}>
                        {one.description}
                      </span>
                    )}
                    {one.here !== null ? (
                      <span className={s.mono}>{t.hereNote(one.here)}</span>
                    ) : one.from !== undefined && !(on && landing != null) ? (
                      <span className={s.from} title={one.from}>
                        <Icon name="computer" size={11} />
                        {one.from}
                      </span>
                    ) : on && landing != null ? (
                      // Keyed by the place, so a place changed lands again.
                      <span key={landing} className={cx(s.mono, s.landing)} title={landing}>
                        <Icon name="folder" size={11} />
                        {landing}
                      </span>
                    ) : (
                      one.pushed !== null && <span>{one.pushed}</span>
                    )}
                  </span>
                </span>
                <span className={cx(s.repoAct, on && s.repoActOn)} aria-hidden="true">
                  <Icon name={on ? 'check' : one.here === null ? 'download' : 'plus'} size={12} />
                  {act}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  })()
  const walking = connecting !== undefined && connecting !== null
  return (
    <div className={s.repos}>
      {!walking && (
        <div className={s.reposBar}>
          <label className={s.find}>
            <Icon name="search" size={14} />
            <input
              ref={field}
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={onField}
              aria-label={t.find}
              placeholder={listing ? t.find : t.findUnconnected}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {connected.length > 1 && (
            <Segmented
              label={t.which}
              value={only}
              onChange={setOnly}
              options={[{ value: 'all', label: t.all }, ...connected.map((host) => ({ value: host.id, label: host.name }))]}
            />
          )}
          {listing && away.length > 0 && (
            <Menu
              label={t.connectHost}
              trigger={
                <Button size="small" icon="plus">
                  {t.connect}
                </Button>
              }
            >
              {away.map((host) => (
                <MenuItem key={host.id} lead={<BrandMark brand={host.brand} size={14} />} onSelect={() => onConnect(host.id)}>
                  {host.name}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
      )}
      {body}
      {!walking && failedNames.length > 0 && (
        <Problem size="small" as="p">
          {t.readFailed(listOr(failedNames))} {onRetry !== undefined && <LinkButton onClick={onRetry}>{t.tryAgain}</LinkButton>}
        </Problem>
      )}
    </div>
  )
}

/* ---- A new repository on a host ---- */

/** A new repository's owner, its name and who can see it, on one line. */
export function NewRepositoryFields({
  owners,
  owner,
  onOwner,
  name,
  onName,
  visibility,
  onVisibility,
  error,
  text,
}: {
  /** Where it can be made; null while they are read. */
  owners: ReadonlyArray<{ readonly id: string; readonly name: string }> | null
  owner: string | null
  onOwner: (owner: string) => void
  name: string
  onName: (name: string) => void
  visibility: 'private' | 'public'
  onVisibility: (visibility: 'private' | 'public') => void
  /** What is wrong with its name or owner, said at the name. */
  error?: ReactNode
  text?: Partial<ProjectSetupText>
}) {
  const t = { ...projectSetupText, ...text }
  const errorId = useId()
  return (
    <div className={s.hostFields}>
      <div className={s.ownerName}>
        <Select
          variant="filled"
          label={t.owner}
          width={140}
          value={owner ?? ''}
          onChange={onOwner}
          disabled={owners === null}
          options={owners === null ? [{ value: '', label: t.readingOwners }] : owners.map((one) => ({ value: one.id, label: one.name }))}
        />
        <span className={s.slash} aria-hidden="true">
          /
        </span>
        <Field
          aria-label={t.name}
          value={name}
          onChange={(event) => onName(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={s.nameField}
          aria-invalid={error !== undefined && error !== null ? true : undefined}
          aria-describedby={error !== undefined && error !== null ? errorId : undefined}
        />
      </div>
      <Segmented
        label={t.visibility}
        value={visibility}
        onChange={onVisibility}
        options={[
          { value: 'private', label: t.private },
          { value: 'public', label: t.public },
        ]}
      />
      {error !== undefined && error !== null && (
        <Problem id={errorId} size="small" as="p" className={s.fieldsError}>
          {error}
        </Problem>
      )}
    </div>
  )
}
