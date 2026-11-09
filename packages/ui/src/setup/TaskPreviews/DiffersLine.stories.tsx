import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Icon } from '../../foundations/Icon/Icon'
import { States } from '../../storybook/States'
import { SettingList, SettingRow, SettingSwitch } from '../Preferences/Preferences'
import { type DifferingProject, DiffersLine, type DiffersLineProps } from './DiffersLine'

const TWO: readonly DifferingProject[] = [
  { id: 'fnt', name: 'fnt', value: 'Open a pull request for review' },
  { id: 'althar', name: 'althar', value: 'Off' },
]

const EIGHT: readonly DifferingProject[] = [
  { id: 'fnt', name: 'fnt', value: 'On' },
  { id: 'althar', name: 'althar', value: 'On' },
  { id: 'meridian', name: 'meridian', value: 'On' },
  { id: 'ledger', name: 'ledger', value: 'On' },
  { id: 'site', name: 'site', value: 'On' },
  { id: 'billing', name: 'billing', value: 'On' },
  { id: 'mobile', name: 'mobile', value: 'On' },
  { id: 'infra', name: 'infra', value: 'On' },
]

const LONG: readonly DifferingProject[] = [
  { id: 'long', name: 'customer-onboarding-and-identity-verification-service', value: 'Open a pull request for review' },
  { id: 'fnt', name: 'fnt', value: 'Push the branch only' },
]

const onUseEverywhere = fn()

/** As it sits: the note of a row of what new projects start with, beside the setting it is about. */
function InRow(props: DiffersLineProps) {
  return (
    <SettingList>
      <SettingSwitch
        title="Post screenshots to pull requests automatically"
        glyph={<Icon name="image" size={15} />}
        note={<DiffersLine {...props} />}
        checked={false}
        onChange={fn()}
      />
    </SettingList>
  )
}

const meta = {
  title: 'Setup/TaskPreviews/DiffersLine',
  component: DiffersLine,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
  args: { projects: TWO, onUseEverywhere },
  render: (args) => <InRow {...args} />,
} satisfies Meta<typeof DiffersLine>
export default meta
type Story = StoryObj<typeof meta>

/** Two projects differ: each with its value, and the way to bring them in line. */
export const TwoProjects: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('fnt: Open a pull request for review · althar: Off')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Use this in every project' }))
    await expect(onUseEverywhere).toHaveBeenCalledOnce()
  },
}

/** Eight differ: the first two by name and how many more; the whole list, each with its value, on focus. */
export const EightProjects: Story = {
  args: { projects: EIGHT },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const line = c.getByText('fnt, althar and 6 more')
    await userEvent.tab()
    await expect(line).toHaveFocus()
    await waitFor(() => expect(within(document.body).getAllByText('infra: On').length).toBeGreaterThan(0))
  },
}

/** A long name is cut short with "…", and shows whole on hover or focus. */
export const LongName: Story = {
  args: { projects: LONG },
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.hover(c.getByText(/customer-onboarding/))
    await waitFor(() =>
      expect(
        within(document.body).getAllByText('customer-onboarding-and-identity-verification-service: Open a pull request for review').length,
      ).toBeGreaterThan(0),
    )
  },
}

/** While every project takes it: it says so, and pressing again does nothing. */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const button = c.getByRole('button', { name: 'Using it in every project…' })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    onUseEverywhere.mockClear()
    await userEvent.click(button)
    await expect(onUseEverywhere).not.toHaveBeenCalled()
  },
}

/** It couldn't: why, beside the button, which tries again. */
export const Failed: Story = {
  args: { error: 'althar’s settings couldn’t be saved.' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('alert')).toHaveTextContent('althar’s settings couldn’t be saved.')
    onUseEverywhere.mockClear()
    await userEvent.click(c.getByRole('button', { name: 'Try again' }))
    await expect(onUseEverywhere).toHaveBeenCalledOnce()
  },
}

/** No project differs: nothing under the row. */
export const NoneDiffer: Story = {
  args: { projects: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Use this in every project' })).toBeNull()
  },
}

/** Kept the way a consumer keeps it: pressed, it works, then no project differs. */
function Kept() {
  const [projects, setProjects] = useState<readonly DifferingProject[]>(TWO)
  const [busy, setBusy] = useState(false)
  return (
    <InRow
      projects={projects}
      busy={busy}
      onUseEverywhere={() => {
        setBusy(true)
        setTimeout(() => {
          setBusy(false)
          setProjects([])
        }, 300)
      }}
    />
  )
}

export const UsingItEverywhere: Story = {
  render: () => <Kept />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Use this in every project' }))
    await expect(c.getByRole('button', { name: 'Using it in every project…' })).toBeInTheDocument()
    await waitFor(() => expect(c.queryByText(/althar: Off/)).toBeNull())
  },
}

export const TwoProjectsDark: Story = { ...TwoProjects, globals: { theme: 'dark' } }

/** In the narrowest sheet, under a choice: the line and its button wrap rather than overflow. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
  render: (args) => (
    <SettingList>
      <SettingRow title="When a task is done" note={<DiffersLine {...args} />} glyph={<Icon name="pr" size={15} />}>
        {() => <span style={{ fontSize: 12.5 }}>Open a draft PR</span>}
      </SettingRow>
    </SettingList>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'two', node: <DiffersLine projects={TWO} onUseEverywhere={fn()} /> },
        { state: 'eight', node: <DiffersLine projects={EIGHT} onUseEverywhere={fn()} /> },
        { state: 'long name', node: <DiffersLine projects={LONG} onUseEverywhere={fn()} /> },
        { state: 'busy', node: <DiffersLine projects={TWO} busy onUseEverywhere={fn()} /> },
        { state: 'failed', node: <DiffersLine projects={TWO} error="althar’s settings couldn’t be saved." onUseEverywhere={fn()} /> },
      ]}
    />
  ),
}
