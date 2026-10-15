// Scrappy: C · runnables as chips in the bar, each its own toggle: press one to run it; a running one opens to say where it answers, and stops.
import { Fragment } from 'react'

import { Button } from '../../../src/primitives/Button/Button'
import { Code } from '../../../src/primitives/Code/Code'
import { Tooltip } from '../../../src/primitives/HoverCard/HoverCard'
import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { KeyValues } from '../../../src/primitives/KeyValues/KeyValues'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { Menu, MenuCheckboxItem, MenuItem, MenuSeparator } from '../../../src/primitives/Menu/Menu'
import { Popover } from '../../../src/primitives/Popover/Popover'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import { addressOf } from '../../../../../apps/desktop/src/renderer/shared/running'
import { css, isLive, label, RunGlyph, sourceText, stateOf, useDialogs, useRuns, whereOf } from '../parts'
import type { Runnable } from '../state'

/** The chip's short name, so several fit in the bar: Public site, Storybook, UI tests. */
const short = (one: Runnable) =>
  (one.name ?? one.command).replace('Desktop end-to-end tests', 'E2E tests').replace('Probe the agents’ tools', 'Probe tools')

export function C() {
  const r = useRuns()
  const dialogs = useDialogs()
  const task = r.screen.place === 'task'
  const opened = r.opening === 'menu'

  const adding = (
    <>
      <MenuItem icon="agents" description="It reads package.json and DEVELOPMENT.md." onSelect={() => dialogs.add('ask')}>
        Ask the coordinator to work it out
      </MenuItem>
      <MenuItem icon="list" onSelect={() => dialogs.add('scripts')}>
        Pick from package.json…
      </MenuItem>
      <MenuItem icon="terminal" onSelect={() => dialogs.add('type')}>
        Type a command…
      </MenuItem>
    </>
  )

  if (r.def === null)
    return (
      <>
        <Menu
          label="Something to run"
          align="end"
          width={320}
          defaultOpen={opened}
          trigger={
            <Button size="small" variant="quiet" icon="plus">
              Something to run
            </Button>
          }
        >
          {adding}
        </Menu>
        {dialogs.node}
      </>
    )

  // In the bar: the default, then what runs or ran here, then the rest in order, as many as fit; the others under "more".
  const max = task ? 3 : 4
  const def = r.def
  const order = [
    def,
    ...r.runnables.filter((one) => one.id !== def.id && r.runOf(one) !== null),
    ...r.runnables.filter((one) => one.id !== def.id && r.runOf(one) === null),
  ]
  const shown = order.slice(0, max)
  const rest = r.runnables.filter((one) => !shown.includes(one))

  const chip = (one: Runnable) => {
    const run = r.runOf(one)
    const about = `${one.command} · ${whereOf(one, r.screen)} · ${sourceText[one.source]}`
    if (!isLive(run))
      return (
        <Tooltip key={one.id} label={run === null ? about : `${stateOf(one, run, r.now)} · press to run it again`} placement="below">
          <Button size="small" variant="quiet" onClick={() => r.start(one)}>
            <span className={css.inline}>
              <RunGlyph run={run} />
              <span className={run?.state === 'failed' ? css.bad : undefined}>{short(one)}</span>
            </span>
          </Button>
        </Tooltip>
      )
    // Running, it opens: where it answers, for how long, and Stop.
    return (
      <Popover
        key={one.id}
        label={label(one)}
        align="end"
        width={340}
        defaultOpen={opened && one.id === def.id}
        trigger={
          <Button size="small">
            <span className={css.inline}>
              {run.state === 'starting' ? <Spinner size="small" /> : <LiveDot />}
              {short(one)}
              {run.url !== null && <span className={css.meta}>{`:${new URL(run.url).port}`}</span>}
            </span>
          </Button>
        }
      >
        <div className={css.stack}>
          <span className={css.name}>{label(one)}</span>
          <KeyValues
            keyWidth={72}
            items={[
              ['Command', <Code key="c">{one.command}</Code>],
              ['Runs', task && one.where !== 'main' ? 'In this task’s worktree' : 'On main'],
              ['Now', stateOf(one, run, r.now) ?? ''],
              ['Came from', sourceText[one.source]],
            ]}
          />
          <div className={css.row}>
            {run.url !== null && (
              <Button size="small" icon="external" onClick={() => r.open(run)}>
                {`Open ${addressOf(run.url)}`}
              </Button>
            )}
            <span className={css.grow} />
            <Button size="small" icon="pencil" variant="quiet" onClick={() => dialogs.edit(one.id)}>
              Edit
            </Button>
            <Button size="small" icon="stop" onClick={() => r.toggle(one)}>
              Stop
            </Button>
          </div>
        </div>
      </Popover>
    )
  }

  return (
    <>
      {shown.map((one) => (
        <Fragment key={one.id}>{chip(one)}</Fragment>
      ))}
      <Menu
        label={task ? 'What this task runs' : 'What althar runs'}
        align="end"
        width={400}
        defaultOpen={r.opening === 'more'}
        trigger={
          rest.length > 0 ? (
            <Button size="small" variant="quiet" trailingIcon="chevronD">
              {`${rest.length} more`}
            </Button>
          ) : (
            <IconButton icon="plus" size="small" label="Add something to run" />
          )
        }
      >
        {rest.map((one) => {
          const run = r.runOf(one)
          return (
            <MenuCheckboxItem
              key={one.id}
              checked={isLive(run)}
              onCheckedChange={() => r.toggle(one)}
              description={stateOf(one, run, r.now) ?? `${one.command} · ${whereOf(one, r.screen)}`}
            >
              {label(one)}
            </MenuCheckboxItem>
          )
        })}
        {rest.length > 0 && <MenuSeparator />}
        {adding}
        <MenuSeparator />
        <MenuItem icon="list" description="Which show in the bar, their order, the default." onSelect={() => dialogs.manage()}>
          Edit the list…
        </MenuItem>
      </Menu>
      {rest.length > 0 && <IconButton icon="plus" size="small" label="Add something to run" onClick={() => dialogs.add('type')} />}
      {dialogs.node}
    </>
  )
}
