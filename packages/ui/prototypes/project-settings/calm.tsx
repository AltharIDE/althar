// Scrappy: what F to J share: the project's settings as one-line rows of the kit's own controls, with no icon beside each; brand marks only where they name a product.
import { type ReactNode, useEffect, useState } from 'react'

import {
  BrandMark,
  Button,
  Icon,
  LinkButton,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  PermissionPolicy,
  permissionPolicyText,
  ProjectMark,
  Switch,
} from '../../src/index'
import { type ProjectRulesView, useQueryClient } from './deps'
import { AddTrackerMenu, Identity, type Link, overlay, PROJECT, type Things } from './parts'
import c from './calm.module.css'

import { keys } from '../../../../apps/desktop/src/renderer/data/reads'
import { useServices } from '../../../../apps/desktop/src/renderer/data/services'

const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

/* ——— The rules it changes from here: what isn't covered, how a task ends. ——— */

type Change = Partial<Pick<ProjectRulesView, 'permissions' | 'allowEverything' | 'end'>>

export function useSetRules() {
  const { client } = useServices()
  const cache = useQueryClient()
  return (change: Change) => {
    cache.setQueryData<ProjectRulesView>(keys.rules(PROJECT), (now: ProjectRulesView | undefined) =>
      now === undefined ? now : { ...now, ...change },
    )
    void client.setProjectRules({ projectId: PROJECT, ...change })
  }
}

export type Asking = ProjectRulesView['permissions']
const POLICY: Record<Asking, PermissionPolicy> = {
  rules: PermissionPolicy.Rules,
  coordinator: PermissionPolicy.Coordinator,
  ask: PermissionPolicy.Ask,
}
export const askingText = (asking: Asking) => permissionPolicyText[POLICY[asking]]

export type Ending = 'draft' | 'ready' | 'none'
export const endingText: Record<Ending, { readonly title: string; readonly short: string }> = {
  draft: { title: 'Open a draft pull request', short: 'a draft pull request' },
  ready: { title: 'Open a pull request for review', short: 'a pull request for review' },
  none: { title: 'Push the branch only', short: 'its branch, pushed' },
}
export const endingOf = (rules: ProjectRulesView): Ending => rules.end ?? 'draft'

/** Escape closes what covers the board, unless a menu or dialog over it takes it first. */
export function useEscape(close: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role=menu], [role=dialog]') !== null) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
}

/* ——— The pieces. ——— */

/** A group: a small title, then its lines on one sheet. */
export function Block({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={c.block}>
      {title !== undefined && (
        <div className={c.blockHead}>
          <h3 className={c.blockTitle}>{title}</h3>
          {aside !== undefined && <span className={c.blockAside}>{aside}</span>}
        </div>
      )}
      <div className={c.sheet}>{children}</div>
    </section>
  )
}

/** One line: what it is, then its value or control; a note under it only when something is wrong. */
export function Line({
  label,
  lead,
  end,
  note,
  yours = false,
  off = false,
}: {
  label: ReactNode
  lead?: ReactNode
  end?: ReactNode
  note?: ReactNode
  yours?: boolean
  off?: boolean
}) {
  return (
    <div className={cx(c.item, yours && c.yours)}>
      <div className={c.line}>
        {lead !== undefined && <span className={c.brand}>{lead}</span>}
        <span className={cx(c.label, off && c.off)}>{label}</span>
        {end !== undefined && <span className={c.end}>{end}</span>}
      </div>
      {note !== undefined && <p className={c.note}>{note}</p>}
    </div>
  )
}

export function SwitchLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <Line label={label} end={<Switch checked={checked} onChange={onChange} label={label} />} />
}

/** A value that opens a menu of the others. */
export function Pick<V extends string>({
  label,
  value,
  options,
  onChange,
  after,
}: {
  label: string
  value: V
  options: ReadonlyArray<{ value: V; title: string; note?: string }>
  onChange: (value: V) => void
  after?: ReactNode
}) {
  const shown = options.find((one) => one.value === value)
  return (
    <Menu
      label={label}
      align="end"
      width={300}
      trigger={
        <button type="button" className={c.pick}>
          <span>{shown?.title}</span>
          <Icon name="chevronD" size={13} />
        </button>
      }
    >
      <MenuRadioGroup label={label} value={value} onChange={(next) => onChange(next as V)}>
        {options.map((one) => (
          <MenuRadioItem key={one.value} value={one.value} {...(one.note === undefined ? {} : { description: one.note })}>
            {one.title}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {after}
    </Menu>
  )
}

/* ——— The project at the head. ——— */

/** Its mark and name, large, with what it is in a line; Change opens the kit's name and colour in place. */
export function Head({ things, end, size = 44 }: { things: Things; end?: ReactNode; size?: number }) {
  const [changing, setChanging] = useState(false)
  return (
    <div className={c.block}>
      <div className={c.head}>
        <ProjectMark seed={things.seed} ink={things.ink} size={size} />
        <div className={c.headText}>
          <h2 className={c.headName}>{things.name}</h2>
          <span className={c.headMeta}>
            {things.host?.what ?? ''} · {things.worktrees} ·{' '}
            <LinkButton onClick={() => setChanging(!changing)}>{changing ? 'Done' : 'Rename or recolour'}</LinkButton>
          </span>
        </div>
        {end !== undefined && <span className={c.blockAside}>{end}</span>}
      </div>
      {changing && (
        <div className={c.sheet} style={{ padding: 14 }}>
          <Identity things={things} />
        </div>
      )}
    </div>
  )
}

/* ——— The switches it has, one click away. ——— */

export const switchText = {
  allow: 'Allow everything',
  move: 'Move issues to In Progress as their task starts',
  conflicts: 'Resolve merge conflicts automatically',
}

export function Switches({ things }: { things: Things }) {
  const rules = things.rules
  if (rules === null) return null
  return (
    <>
      <SwitchLine label={switchText.allow} checked={rules.allowEverything} onChange={things.setAllowEverything} />
      {things.trackers.length > 0 && (
        <SwitchLine label={switchText.move} checked={rules.moveIssues} onChange={things.model.setMoveIssues} />
      )}
      <SwitchLine label={switchText.conflicts} checked={rules.resolveConflicts} onChange={things.model.setResolveConflicts} />
    </>
  )
}

/* ——— Code and issues: a line each, the connection's account on the right. ——— */

export const troubleText = (link: Link) =>
  link.trouble === 'not-connected'
    ? `Althar isn’t connected to ${link.name}, so it can’t read or move ${link.what}.`
    : link.id === 'host'
      ? `Signed out of ${link.name}: no project can push or open pull requests until you sign in again.`
      : `Signed out of ${link.name}: Althar can’t read or move ${link.what}.`
export const fixText = (link: Link) => (link.trouble === 'signed-out' ? 'Sign in again' : 'Connect')

/** What else a connection's line can do: open it, take a tracker out, the app's connections. */
function LinkMore({ link, things }: { link: Link; things: Things }) {
  return (
    <Menu
      label={`${link.name}: ${link.what}`}
      align="end"
      trigger={
        <button type="button" className={c.pick} aria-label={`More for ${link.name}`}>
          <Icon name="more" size={14} />
        </button>
      }
    >
      {link.url !== null && (
        <MenuItem icon="external" onSelect={() => window.open(link.url ?? '', '_blank')}>
          Open on {link.name}
        </MenuItem>
      )}
      {link.id === 'host' ? (
        <MenuItem icon="folder" onSelect={things.openRepositories}>
          Add or change repositories…
        </MenuItem>
      ) : (
        <MenuItem icon="remove" onSelect={() => things.removeTracker(link)}>
          Take out of {things.name}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon="plug" description="Shared by every project on it" onSelect={things.manageConnections}>
        Manage the {link.name} connection
      </MenuItem>
    </Menu>
  )
}

export function LinkLine({ link, things }: { link: Link; things: Things }) {
  return (
    <Line
      lead={<BrandMark brand={link.brand} size={14} />}
      label={
        <>
          {link.name} <span className={c.what}>· {link.what}</span>
        </>
      }
      yours={link.trouble !== null}
      {...(link.trouble === null ? {} : { note: troubleText(link) })}
      end={
        <>
          {link.found && <span className={c.tag}>found in tasks</span>}
          {link.trouble === null ? (
            <span>{link.login}</span>
          ) : (
            <Button size="small" variant="signal" onClick={() => things.connect(link)}>
              {fixText(link)}
            </Button>
          )}
          <LinkMore link={link} things={things} />
        </>
      }
    />
  )
}

/** Its code host, its trackers, and a way to add one; with none, the line says what that means. */
export function CodeAndIssues({ things }: { things: Things }) {
  const none = things.trackers.length === 0
  return (
    <>
      {things.host !== null && <LinkLine link={things.host} things={things} />}
      {things.trackers.map((link) => (
        <LinkLine key={link.id} link={link} things={things} />
      ))}
      <Line
        lead={<Icon name="plus" size={14} />}
        label={none ? 'No tracker: tasks don’t start from issues' : 'Add a tracker'}
        off={!none}
        end={<AddTrackerMenu things={things} trigger={<Button size="small">{none ? 'Add a tracker' : 'Add…'}</Button>} />}
      />
    </>
  )
}

export function Shared({ things }: { things: Things }) {
  return (
    <p className={c.caption}>
      Connections are shared by every project. <LinkButton onClick={things.manageConnections}>Manage connections</LinkButton>
    </p>
  )
}

/* ——— How its tasks work. ——— */

export function AskingLine({ things }: { things: Things }) {
  const set = useSetRules()
  const rules = things.rules
  if (rules === null) return null
  return (
    <Line
      label="What the rules don’t cover"
      off={rules.allowEverything}
      end={
        rules.allowEverything ? (
          <span>Allowed, while everything is</span>
        ) : (
          <Pick<Asking>
            label="What the rules don’t cover"
            value={rules.permissions}
            onChange={(permissions) => set({ permissions })}
            options={(['ask', 'coordinator', 'rules'] as const).map((one) => ({
              value: one,
              title: askingText(one).title,
              note: askingText(one).note,
            }))}
            after={
              <>
                <MenuSeparator />
                <MenuItem icon="list" onSelect={things.openRules}>
                  Every rule…
                </MenuItem>
              </>
            }
          />
        )
      }
    />
  )
}

export function EndingLine({ things }: { things: Things }) {
  const set = useSetRules()
  const rules = things.rules
  if (rules === null) return null
  return (
    <Line
      label="When a task finishes"
      end={
        <Pick<Ending>
          label="When a task finishes"
          value={endingOf(rules)}
          onChange={(end) => set({ end })}
          options={(['draft', 'ready', 'none'] as const).map((one) => ({ value: one, title: endingText[one].title }))}
        />
      }
    />
  )
}

export function BranchesLine({ things }: { things: Things }) {
  return (
    <Line
      label="Branches"
      end={
        <>
          <span className={c.mono}>{things.branches}</span>
          <LinkButton onClick={things.openRules}>Change</LinkButton>
        </>
      }
    />
  )
}

export function RunLine({ things }: { things: Things }) {
  const [first, ...rest] = things.runnables
  return (
    <Line
      label="Run starts"
      end={
        <>
          <span className={c.mono}>{first?.command ?? 'nothing yet'}</span>
          {rest.length > 0 && <span>+{rest.length} kept</span>}
          <LinkButton onClick={() => overlay.set({ runs: true })}>Edit</LinkButton>
        </>
      }
    />
  )
}

export function WorktreesLine({ things }: { things: Things }) {
  return (
    <Line
      label="Worktrees"
      end={
        <>
          <span className={c.mono}>{things.worktrees}</span>
          <LinkButton>Move</LinkButton>
        </>
      }
    />
  )
}

export function RulesLine({ things }: { things: Things }) {
  return <Line label="Commands, accounts and usage limits" off end={<LinkButton onClick={things.openRules}>Every rule</LinkButton>} />
}

/** Everything about how its tasks run, in order. */
export function TaskLines({ things, rules = true }: { things: Things; rules?: boolean }) {
  return (
    <>
      <AskingLine things={things} />
      <EndingLine things={things} />
      <BranchesLine things={things} />
      <RunLine things={things} />
      <WorktreesLine things={things} />
      {rules && <RulesLine things={things} />}
    </>
  )
}

/* ——— Notes, quoted short. ——— */

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function NoteLines({ things, most }: { things: Things; most?: number }) {
  const notes = [...(things.model.notes ?? [])].reverse()
  const shown = most === undefined ? notes : notes.slice(0, most)
  if (notes.length === 0) return <Line label="No notes yet: the coordinator keeps what you decide in conversation" off />
  return (
    <div className={c.notes}>
      {shown.map((note) => (
        <div key={note.id} className={c.noteLine}>
          <span>{note.body}</span>
          <span className={c.noteWhen}>{dayOf(note.createdAt)}</span>
        </div>
      ))}
    </div>
  )
}

export const notesCount = (things: Things) => things.model.notes?.length ?? 0

export function RemoveLink({ things }: { things: Things }) {
  return <LinkButton onClick={() => overlay.set({ removing: true })}>Remove {things.name} from Althar…</LinkButton>
}

/** The project's button at the front page's end: its name's settings, not a second gear. */
export function ProjectButton({ onClick, open }: { onClick?: () => void; open?: boolean }) {
  return (
    <Button size="small" variant="quiet" onClick={onClick} {...(open === undefined ? {} : { 'aria-expanded': open })}>
      Project settings
    </Button>
  )
}

export { c as calm, cx }
