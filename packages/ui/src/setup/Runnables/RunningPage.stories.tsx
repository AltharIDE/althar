import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { SettingGroup, SettingList, SettingRow } from '../Preferences/Preferences'
import { SettingsLayout } from '../SettingsLayout/SettingsLayout'
import { SettingsNav } from '../SettingsNav/SettingsNav'
import { LONG } from './long'
import { RunnableList } from './Runnables'

/*
 * A project's Settings › Running, laid out as the desktop app's
 * RunningSection lays it: what it runs, dozens of labs and prototypes among
 * them, then where its tasks' work goes, with the way to change it.
 */

function Page({ onWorksIn, onAdd }: { onWorksIn: () => void; onAdd: () => void }) {
  const [order, setOrder] = useState(LONG)
  const ids = order.map((one) => one.id)
  const put = (next: readonly string[]) => setOrder(next.flatMap((id) => order.filter((one) => one.id === id)))
  return (
    <div style={{ minHeight: '100vh' }}>
      <SettingsLayout
        section="running"
        title="Running"
        headingLevel={2}
        side={
          <SettingsNav
            label="Project settings"
            groups={[
              [
                { id: 'general', title: 'General', icon: 'gear' },
                { id: 'code', title: 'Code and issues', icon: 'plug' },
              ],
              [
                { id: 'tasks', title: 'Tasks', icon: 'work' },
                { id: 'rules', title: 'Rules', icon: 'lock' },
                { id: 'running', title: 'Running', icon: 'play' },
              ],
              [{ id: 'notes', title: 'Notes', icon: 'quote' }],
            ]}
            value="running"
            onChange={fn()}
            action={{ title: 'Remove from Althar…', icon: 'close', danger: true, onSelect: fn() }}
          />
        }
      >
        <SettingGroup
          title="What it runs"
          headingLevel={3}
          note="Run starts the first. Drag to change the order."
          action={
            <Button size="small" icon="plus" onClick={onAdd}>
              Add something to run
            </Button>
          }
        >
          <RunnableList
            runnables={order}
            onOrder={put}
            onDefault={(id) => put([id, ...ids.filter((one) => one !== id)])}
            onEdit={fn()}
            onRemove={(id) => setOrder(order.filter((one) => one.id !== id))}
          />
        </SettingGroup>
        <SettingGroup title="Where its work goes" headingLevel={3}>
          <SettingList>
            <SettingRow
              title="Worktrees"
              note={<Code>~/Althar/althar</Code>}
              mark={<Icon name="folder" size={15} style={{ color: 'var(--t-3)' }} />}
            >
              {({ labelledBy }) => (
                <Button size="small" aria-describedby={labelledBy} onClick={onWorksIn}>
                  Change
                </Button>
              )}
            </SettingRow>
          </SettingList>
        </SettingGroup>
      </SettingsLayout>
    </div>
  )
}

const meta = {
  title: 'Setup/Running page',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: { onWorksIn: fn(), onAdd: fn() },
} satisfies Meta<typeof Page>
export default meta
type Story = StoryObj<typeof meta>

/** Dozens to run, the first few in sight and the rest a search or a press away; where its work goes, and the way to change it. */
export const LongList: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('button', { name: /^Drag to move/ })).toHaveLength(8)
    await userEvent.click(c.getByRole('button', { name: 'Change' }))
    await expect(args.onWorksIn).toHaveBeenCalledOnce()
  },
}

/** The same, at night. */
export const LongListDark: Story = { ...LongList, globals: { theme: 'dark' } }

/** The person's own, picked out of the dozens. */
export const Yours: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('radio', { name: 'Yours' }))
  },
}
