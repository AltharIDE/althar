// H · Written out: the project's settings as a few sentences, every value in them a word that opens its choices; what needs you is the word in violet. Anything else, you tell the lead.
import { type ReactElement, type ReactNode, useState } from 'react'

import { BrandMark, Button, LinkButton, Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Popover } from '../../../src/index'
import {
  type Asking,
  askingText,
  Block,
  calm as c,
  cx,
  type Ending,
  endingOf,
  endingText,
  fixText,
  NoteLines,
  notesCount,
  RemoveLink,
  troubleText,
  useSetRules,
} from '../calm'
import { AddTrackerMenu, Identity, type Link, overlay, type Things } from '../parts'
import { proto, useProto } from '../state'

/** A word that opens a menu of its choices. */
function Word({ label, children, yours = false, menu }: { label: string; children: ReactNode; yours?: boolean; menu: ReactNode }) {
  return (
    <Menu
      label={label}
      width={300}
      trigger={
        <button type="button" className={cx(c.word, yours && c.yours)}>
          {children}
        </button>
      }
    >
      {menu}
    </Menu>
  )
}

/** A word that does one thing. */
function Press({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={c.word} onClick={onClick}>
      {children}
    </button>
  )
}

/** A choice of two or more, in a word. */
function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
  after,
}: {
  label: string
  value: V
  options: ReadonlyArray<{ value: V; word: string; title: string; note?: string }>
  onChange: (value: V) => void
  after?: ReactNode
}) {
  return (
    <Word
      label={label}
      menu={
        <>
          <MenuRadioGroup label={label} value={value} onChange={(next) => onChange(next as V)}>
            {options.map((one) => (
              <MenuRadioItem key={one.value} value={one.value} {...(one.note === undefined ? {} : { description: one.note })}>
                {one.title}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {after}
        </>
      }
    >
      {options.find((one) => one.value === value)?.word}
    </Word>
  )
}

/** A code host or tracker, as a word: its mark and what of it is the project's; violet where it needs you. */
function LinkWord({ link, things }: { link: Link; things: Things }) {
  return (
    <Word
      label={`${link.name}: ${link.what}`}
      yours={link.trouble !== null}
      menu={
        <>
          {link.trouble !== null && (
            <MenuItem icon="plug" description={troubleText(link)} onSelect={() => things.connect(link)}>
              {fixText(link)}
            </MenuItem>
          )}
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
        </>
      }
    >
      <BrandMark brand={link.brand} size={12} /> {link.name === 'GitHub' ? link.what : `${link.name} ${link.what.replace(' issues', '')}`}
    </Word>
  )
}

const and = (words: ReadonlyArray<ReactElement>) =>
  words.flatMap((word, i) => (i === 0 ? [word] : [<span key={`and${i}`}>{i === words.length - 1 ? ' and ' : ', '}</span>, word]))

function Sentences({ things, onNotes, onName }: { things: Things; onNotes: () => void; onName: () => void }) {
  const set = useSetRules()
  const rules = things.rules
  const host = things.host
  if (rules === null) return null
  const signedOut = host?.trouble != null
  const [first, ...rest] = things.runnables
  const trackers = things.trackers
  const out = trackers.filter((one) => one.trouble !== null)
  return (
    <div className={c.prose}>
      <p>
        <Press onClick={onName}>{things.name}</Press> works on {host !== null && <LinkWord link={host} things={things} />}
        {host !== null && (signedOut ? ', but Althar is signed out of GitHub.' : `, as ${host.login ?? ''}.`)}{' '}
        {trackers.length === 0 ? (
          <>
            It has{' '}
            <AddTrackerMenu
              things={things}
              trigger={
                <button type="button" className={c.word}>
                  no tracker
                </button>
              }
            />
            , so tasks don’t start from issues.
          </>
        ) : (
          <>
            Its issues are in {and(trackers.map((link) => <LinkWord key={link.id} link={link} things={things} />))}
            {trackers[0]?.found === true ? ', found in its tasks.' : '.'}
            {out.length > 0 && ` Althar isn’t connected to ${out.map((one) => one.name).join(' or ')} yet.`}
          </>
        )}
      </p>
      <p>
        {trackers.length > 0 && (
          <>
            When a task starts, Althar{' '}
            <Choice<'on' | 'off'>
              label="Move issues to In Progress"
              value={rules.moveIssues ? 'on' : 'off'}
              onChange={(on) => things.model.setMoveIssues(on === 'on')}
              options={[
                { value: 'on', word: 'moves its issue to In Progress', title: 'Move the issue to In Progress' },
                { value: 'off', word: 'leaves its issue alone', title: 'Leave the issue alone' },
              ]}
            />
            .{' '}
          </>
        )}
        Agents{' '}
        <Choice<'all' | Asking>
          label="What agents may do"
          value={rules.allowEverything ? 'all' : rules.permissions}
          onChange={(next) => (next === 'all' ? things.setAllowEverything(true) : set({ allowEverything: false, permissions: next }))}
          options={[
            {
              value: 'all',
              word: 'may do everything',
              title: 'Allow everything',
              note: 'Nothing waits for you; what’s never allowed still is',
            },
            {
              value: 'ask',
              word: 'ask you about what the rules don’t cover',
              title: askingText('ask').title,
              note: askingText('ask').note,
            },
            {
              value: 'coordinator',
              word: 'leave what the rules don’t cover to the coordinator',
              title: askingText('coordinator').title,
              note: askingText('coordinator').note,
            },
            { value: 'rules', word: 'may do what the rules don’t keep', title: askingText('rules').title, note: askingText('rules').note },
          ]}
          after={
            <>
              <MenuSeparator />
              <MenuItem icon="list" onSelect={things.openRules}>
                Every rule…
              </MenuItem>
            </>
          }
        />
        , and merge conflicts are{' '}
        <Choice<'on' | 'off'>
          label="Resolve merge conflicts automatically"
          value={rules.resolveConflicts ? 'on' : 'off'}
          onChange={(on) => things.model.setResolveConflicts(on === 'on')}
          options={[
            { value: 'on', word: 'resolved by the lead', title: 'Resolve them automatically' },
            { value: 'off', word: 'left for you', title: 'Leave them for you' },
          ]}
        />
        .
      </p>
      <p>
        A finished task becomes{' '}
        <Choice<Ending>
          label="When a task finishes"
          value={endingOf(rules)}
          onChange={(end) => set({ end })}
          options={(['draft', 'ready', 'none'] as const).map((one) => ({
            value: one,
            word: endingText[one].short,
            title: endingText[one].title,
          }))}
        />{' '}
        on a branch named{' '}
        <Press onClick={things.openRules}>
          <span className={c.mono}>{things.branches}</span>
        </Press>
        . Run starts{' '}
        <Press onClick={() => overlay.set({ runs: true })}>
          <span className={c.mono}>{first?.command ?? 'nothing yet'}</span>
        </Press>
        {rest.length > 0 && `, and ${rest.length} more are kept`}. The coordinator keeps{' '}
        <Press onClick={onNotes}>{notesCount(things)} notes</Press> about it.
      </p>
    </div>
  )
}

type View = 'all' | 'notes' | 'name'

export function H({ things }: { things: Things }) {
  const p = useProto()
  const [open, setOpen] = useState(p.showing !== 'closed')
  const [view, setView] = useState<View>(p.showing === 'notes' ? 'notes' : 'all')
  const back = (title: string, aside?: ReactNode) => (
    <div className={c.blockHead}>
      <LinkButton onClick={() => setView('all')}>← {things.name}</LinkButton>
      <h3 className={c.blockTitle}>{title}</h3>
      {aside !== undefined && <span className={c.blockAside}>{aside}</span>}
    </div>
  )
  return (
    <Popover
      label={`${things.name} settings`}
      align="end"
      width={480}
      padded={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setView('all')
        proto.set({ showing: next ? 'open' : 'closed' })
      }}
      trigger={
        <Button size="small" variant="quiet">
          Project settings
        </Button>
      }
    >
      {view === 'all' ? (
        <>
          <Sentences things={things} onNotes={() => setView('notes')} onName={() => setView('name')} />
          <div className={c.proseFoot}>
            <span>Or tell the lead: “stop moving issues”</span>
            <RemoveLink things={things} />
          </div>
        </>
      ) : view === 'notes' ? (
        <div className={c.proseDetail}>
          {back('Notes', notesCount(things))}
          <Block>
            <NoteLines things={things} />
          </Block>
        </div>
      ) : (
        <div className={c.proseDetail}>
          {back('Name and colour')}
          <Identity things={things} />
        </div>
      )}
    </Popover>
  )
}
