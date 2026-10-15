// Scrappy: A · a split button. Run runs the default; its chevron lists everything, the running ones on top, and Add… at the end.
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator } from '../../../src/primitives/Menu/Menu'
import { SplitButton } from '../../../src/primitives/SplitButton/SplitButton'
import { Button } from '../../../src/primitives/Button/Button'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { addressOf } from '../../../../../apps/desktop/src/renderer/shared/running'
import { css, isLive, label, sourceText, stateOf, useDialogs, useRuns, whereOf } from '../parts'
import type { Runnable } from '../state'

export function A() {
  const r = useRuns()
  const dialogs = useDialogs()
  const opened = r.opening === 'menu'

  // Nothing known yet: one quiet button, and the three ways to say what runs.
  if (r.def === null)
    return (
      <>
        <Menu
          label="Something to run"
          align="end"
          width={320}
          defaultOpen={opened}
          note="Althar runs it itself, with no agent, and shows where it answers."
          trigger={
            <Button size="small" variant="quiet" icon="terminal" trailingIcon="chevronD">
              Run
            </Button>
          }
        >
          <MenuItem
            icon="agents"
            description="It reads package.json and DEVELOPMENT.md, and says what it would keep."
            onSelect={() => dialogs.add('ask')}
          >
            Ask the coordinator to work it out
          </MenuItem>
          <MenuItem icon="list" description="Any of this repository’s scripts." onSelect={() => dialogs.add('scripts')}>
            Pick from package.json…
          </MenuItem>
          <MenuItem icon="terminal" onSelect={() => dialogs.add('type')}>
            Type a command…
          </MenuItem>
        </Menu>
        {dialogs.node}
      </>
    )

  const def = r.def
  const defRun = r.runOf(def)
  const running = r.runnables.filter((one) => isLive(r.runOf(one)))
  const resting = r.runnables.filter((one) => !isLive(r.runOf(one)))
  const item = (one: Runnable) => {
    const run = r.runOf(one)
    const state = stateOf(one, run, r.now)
    const isDefault = one.id === def.id
    const there = r.elsewhere(one)
    return (
      <MenuCheckboxItem
        key={one.id}
        checked={isLive(run)}
        onCheckedChange={() => r.toggle(one)}
        keepOpen
        hint={
          run?.state === 'starting'
            ? 'Starting…'
            : run?.url != null
              ? addressOf(run.url)
              : isDefault && !isLive(run)
                ? 'Default'
                : undefined
        }
        description={
          [
            one.name === undefined ? null : one.command,
            whereOf(one, r.screen),
            run !== null && !isLive(run) ? state : null,
            there !== null
              ? `running ${there.place === 'main' ? 'on main' : 'in a task'}${there.url === null ? '' : ` at ${addressOf(there.url)}`}`
              : null,
            run === null && there === null ? sourceText[one.source] : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      >
        {label(one)}
      </MenuCheckboxItem>
    )
  }

  // The main half: runs the default; while it runs, says where it answers and opens it.
  const main = isLive(defRun)
    ? defRun.state === 'starting'
      ? { children: `Starting ${label(def)}…`, busy: true, onClick: () => undefined }
      : {
          children: (
            <span className={css.inline}>
              <LiveDot />
              {defRun.url === null ? label(def) : `${label(def)} · ${addressOf(defRun.url)}`}
            </span>
          ),
          onClick: () => r.open(defRun),
        }
    : { children: `Run ${label(def)}`, icon: 'terminal' as const, onClick: () => r.start(def) }
  const others = running.filter((one) => one.id !== def.id).length

  return (
    <>
      <SplitButton
        size="small"
        moreLabel="Everything to run"
        {...main}
        menu={(trigger) => (
          <Menu
            label={`What ${r.screen.place === 'task' ? 'this task' : 'althar'} runs`}
            align="end"
            width={440}
            defaultOpen={opened}
            trigger={trigger}
            note={
              r.screen.place === 'task'
                ? 'Checked ones are running. They run in this task’s worktree, unless they always run on main.'
                : 'Checked ones are running, on main. Pick one to start or stop it.'
            }
          >
            {running.length > 0 && (
              <MenuGroup label={others > 0 ? `Running · ${running.length}` : 'Running'}>{running.map(item)}</MenuGroup>
            )}
            {resting.length > 0 && <MenuGroup label={running.length > 0 ? 'Not running' : 'Run'}>{resting.map(item)}</MenuGroup>}
            <MenuSeparator />
            <MenuItem icon="plus" onSelect={() => dialogs.add('type')}>
              Add something to run…
            </MenuItem>
            <MenuItem icon="list" onSelect={() => dialogs.manage()}>
              Edit the list…
            </MenuItem>
          </Menu>
        )}
      />
      {dialogs.node}
    </>
  )
}
