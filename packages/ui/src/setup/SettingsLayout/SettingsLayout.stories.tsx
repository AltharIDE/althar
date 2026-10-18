import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { IconName } from '../../foundations/Icon/Icon'
import { SettingGroup, SettingList, SettingSwitch } from '../Preferences/Preferences'
import { SettingsNav } from '../SettingsNav/SettingsNav'
import { SettingsLayout } from './SettingsLayout'

type Id = 'general' | 'code' | 'rules' | 'running' | 'notes'

/* A project's sections, as its settings list them down the side. */
const SECTIONS: Readonly<Record<Id, { title: string; lede: string; icon: IconName }>> = {
  general: { title: 'General', lede: 'Its name and colour, and how its tasks work.', icon: 'gear' },
  code: { title: 'Code and issues', lede: 'Its repositories and where their work goes, and its trackers.', icon: 'plug' },
  rules: { title: 'Rules', lede: 'What agents may do without asking, and how a task ends.', icon: 'lock' },
  running: { title: 'Running', lede: 'What it runs with no agent, and where its tasks’ work goes.', icon: 'play' },
  notes: { title: 'Notes', lede: 'What the coordinator keeps from your conversations.', icon: 'quote' },
}

function Page({ start = 'general' }: { start?: Id }) {
  const [section, setSection] = useState<Id>(start)
  const open = SECTIONS[section]
  return (
    <div style={{ height: '100vh' }}>
      <SettingsLayout
        section={section}
        title={open.title}
        lede={open.lede}
        side={
          <SettingsNav
            label="Project settings"
            groups={[
              (['general', 'code'] as const).map((id) => ({ id, ...SECTIONS[id] })),
              (['rules', 'running'] as const).map((id) => ({ id, ...SECTIONS[id] })),
              [{ id: 'notes', ...SECTIONS.notes }],
            ]}
            value={section}
            onChange={setSection}
            action={{ title: 'Remove from Althar…', icon: 'close', danger: true, onSelect: fn() }}
          />
        }
      >
        <SettingGroup title="How its tasks work" note="For every task in Meridian, from its next step on.">
          <SettingList>
            <SettingSwitch
              title="Resolve merge conflicts automatically"
              note="The lead brings main in, fixes the clashing lines and runs the checks again."
              checked
              onChange={fn()}
            />
            <SettingSwitch title="Move issues to In Progress" note="As a task starts from one." checked={false} onChange={fn()} />
          </SettingList>
        </SettingGroup>
      </SettingsLayout>
    </div>
  )
}

const meta = {
  title: 'Setup/SettingsLayout',
  component: Page,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Page>
export default meta
type Story = StoryObj<typeof meta>

/** The sections down the side, the one open on its sheet beside them, named by its title and a line on it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Notes' }))
    await expect(c.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible()
  },
}
