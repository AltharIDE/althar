import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { States, statesParameters } from '../../storybook/States'
import { Listening, type ListenSource } from './Listening'

const PR: ListenSource = {
  id: 'pr',
  mark: Brand.GitHub,
  label: 'PR 1206',
  where: 'meridian-api',
  what: 'review comments and checks',
  last: 'opened 2m ago',
}
const ISSUE: ListenSource = {
  id: 'mer',
  mark: Brand.Linear,
  label: 'MER-431',
  where: 'Payments',
  what: 'comments and status',
  last: '14m ago',
}
const CI: ListenSource = {
  id: 'ci',
  mark: Brand.GitHubActions,
  label: 'Checks on 1206',
  where: 'GitHub Actions',
  what: 'results',
  last: 'running',
}
const NOTE = 'What arrives lands at the end of the thread, and the lead answers it there.'

const meta = {
  title: 'Composer/Listening',
  component: Listening,
  args: { sources: [PR], note: NOTE, onStop: () => {} },
  /* room above for the list, which opens upward; the states grid has no list open */
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        <Story />
      ) : (
        <div style={{ paddingTop: 220 }}>
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof Listening>
export default meta
type Story = StoryObj<typeof meta>

export const OneSource: Story = {}
export const SeveralSources: Story = { args: { sources: [PR, ISSUE, CI] } }
/** Something just arrived; the pill says what for a few seconds. */
export const Heard: Story = { args: { heard: { key: 1, text: 'dana commented on PR 1206' }, hold: true } }
export const Open: Story = {
  args: { sources: [PR, ISSUE, CI], defaultOpen: true },
  decorators: [
    (Story) => (
      <div style={{ paddingTop: 80 }}>
        <Story />
      </div>
    ),
  ],
}
/** Nothing to listen to: nothing shows. */
export const Empty: Story = { args: { sources: [] } }

export const StopOne: Story = {
  render: function Render(args) {
    const [sources, setSources] = useState([PR, ISSUE])
    return <Listening {...args} sources={sources} onStop={(id) => setSources((v) => v.filter((x) => x.id !== id))} />
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: /Listening to/ }))
    await userEvent.click(await page.findByRole('button', { name: 'Stop listening to MER-431' }))
    await expect(page.queryByText('MER-431')).toBeNull()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <Listening sources={[PR]} /> })),
        { state: 'heard', node: <Listening sources={[PR]} heard={{ key: 1, text: 'Checks passed on PR 1206' }} hold /> },
      ]}
    />
  ),
}
