import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Cite, FileRef } from './Inline'

const meta = {
  title: 'Thread/Inline',
  component: FileRef,
  args: { path: 'src/charges/limit.ts', line: 42 },
  decorators: [
    (Story) => (
      <div style={{ paddingTop: 100, maxWidth: 560, fontSize: 14, lineHeight: 1.62 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileRef>
export default meta
type Story = StoryObj<typeof meta>

export const File: Story = {}
export const FileWithoutLine: Story = { args: { line: undefined, path: 'docs/rate-limits.md' } }
export const Citation: Story = {
  render: () => (
    <p style={{ margin: 0 }}>
      The spec counts both against one limit
      <Cite n={1}>
        <b>rate-limits.md</b> · “Refunds and charges draw on one budget per partner.”
      </Cite>
      .
    </p>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    await expect(within(canvasElement).getByRole('button', { name: 'Source 1' })).toHaveFocus()
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toBeInTheDocument())
  },
}
export const AllStates: Story = {
  parameters: statesParameters,
  decorators: [
    (Story) => (
      <div style={{ marginTop: -100 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <States
        cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <FileRef path="src/charges/limit.ts" line={42} /> }))}
      />
      <br />
      <States cells={['rest', 'hover', 'focus'].map((state) => ({ state, node: <Cite n={2}>Decided on task 402.</Cite> }))} />
    </>
  ),
}
