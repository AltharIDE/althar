import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ROUTER_DIFF } from '../../fixtures/meridian'
import { ChangeView, type ChangeViewProps, type FileView, type ViewedFile } from './ChangeView'

const FILES: ViewedFile[] = [
  { path: 'src/charges/limit.ts', status: 'modified', add: 14, del: 3 },
  { path: 'src/refunds/router.ts', status: 'modified', add: 12, del: 1 },
  { path: 'src/refunds/limit.test.ts', status: 'added', add: 48, del: 0 },
  { path: 'docs/retry.md', from: 'docs/retries.md', status: 'renamed', add: 0, del: 0 },
  { path: 'src/legacy/backoff.ts', status: 'deleted', add: 0, del: 22 },
  { path: 'assets/limit.png', status: 'modified', add: 0, del: 0, binary: true },
  { path: 'notes/scratch.md', status: 'added', add: 6, del: 0, uncommitted: true },
]

const meta = {
  title: 'Outputs/ChangeView',
  component: ChangeView,
  parameters: { layout: 'fullscreen' },
  args: {
    branch: 'althar/mer-231-rate-limit-refunds',
    base: 'main',
    files: FILES,
    selected: 'src/refunds/router.ts',
    onSelect: fn(),
    view: { state: 'ready', lines: ROUTER_DIFF },
    onRetry: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ChangeView>
export default meta
type Story = StoryObj<typeof meta>

/** Choosing a file shows it; the view keeps the choice, as the app does. */
const Choosing = (args: ChangeViewProps) => {
  const [selected, setSelected] = useState(args.selected)
  return (
    <ChangeView
      {...args}
      selected={selected}
      onSelect={(path) => {
        args.onSelect(path)
        setSelected(path)
      }}
    />
  )
}

/** A task's change: its files, and the one you're on as a diff. */
export const Changes: Story = {
  render: (args) => <Choosing {...args} />,
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog', { name: 'Changes' })).toBeInTheDocument()
    await expect(body.getByText('althar/mer-231-rate-limit-refunds into main')).toBeInTheDocument()
    await expect(body.getByText('7 files')).toBeInTheDocument()
    // j and k go through the files.
    await userEvent.keyboard('j')
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/refunds/limit.test.ts')
    await userEvent.keyboard('{ArrowUp}')
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/refunds/router.ts')
    await userEvent.click(body.getByRole('button', { name: /backoff\.ts/ }))
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/legacy/backoff.ts')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
  },
}

const at = (selected: string, view: FileView) => ({ selected, view })

/** Being read. */
export const Loading: Story = { args: at('src/charges/limit.ts', { state: 'loading' }) }
/** Couldn't be read: it says so, and tries again. */
export const Failed: Story = {
  args: at('src/charges/limit.ts', { state: 'failed' }),
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}
/** A picture: its contents aren't shown. */
export const Binary: Story = { args: at('assets/limit.png', { state: 'ready', lines: [] }) }
/** Moved, nothing else changed. */
export const Moved: Story = { args: at('docs/retry.md', { state: 'ready', lines: [] }) }
/** Not committed yet, so not in what Althar pushes. */
export const NotCommitted: Story = { args: at('notes/scratch.md', { state: 'ready', lines: ROUTER_DIFF.slice(0, 5) }) }
/** Longer than it shows. */
export const CutShort: Story = { args: at('src/refunds/router.ts', { state: 'ready', lines: ROUTER_DIFF, truncated: true }) }
/** Nothing changed yet. */
export const Nothing: Story = { args: { files: [], selected: null, view: { state: 'ready', lines: [] } } }
/** On a phone-width window, the files sit above the diff. */
export const Narrow: Story = { globals: { viewport: { value: 'mobile1' } } }
/** In the app on macOS: the system's lights sit over the window's top row, so the view stays below it. */
export const UnderTheLights: Story = { args: { lights: 'space' } }
/** Narrow, under the lights: the whole window but its top row. */
export const NarrowUnderTheLights: Story = { args: { lights: 'space' }, globals: { viewport: { value: 'mobile1' } } }
