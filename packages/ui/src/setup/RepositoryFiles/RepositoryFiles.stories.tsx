import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Button } from '../../primitives/Button/Button'
import { ControlCenter, ControlDetail, ControlGrid, ControlModule, ControlSheet, ControlWords } from '../ControlCenter/ControlCenter'
import { RepositoryFiles, type RepositoryFilesProps, repositoryFilesText, type RepositoryFilesValue } from './RepositoryFiles'

/* Each off, as a project starts. */
const OFF: RepositoryFilesValue = { writeSkills: false, writeOpenSpec: false, pushProtected: false }

/* As a consumer keeps them: one switched shows at once. */
function Kept(args: RepositoryFilesProps) {
  const [value, setValue] = useState(args.value)
  return (
    <RepositoryFiles
      {...args}
      value={value}
      onChange={(file, on) => {
        setValue((was) => ({ ...was, [file]: on }))
        args.onChange(file, on)
      }}
    />
  )
}

/* On the panel's lighter sheet, at the panel's width, as it sits in the project's settings. */
function Sheet({ children }: { children: ReactNode }) {
  return <div style={{ width: 416, padding: '14px 16px', borderRadius: 15, background: 'var(--frost-raised)' }}>{children}</div>
}

const meta = {
  title: 'Setup/RepositoryFiles',
  component: RepositoryFiles,
  args: { value: OFF, onChange: fn() },
  render: (args) => (
    <Sheet>
      <Kept {...args} />
    </Sheet>
  ),
} satisfies Meta<typeof RepositoryFiles>
export default meta
type Story = StoryObj<typeof meta>

/** As a project starts: each off, pushing blocked. Each switches on its own. */
export const AsItStarts: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const push = c.getByRole('switch', { name: 'Push skill/OpenSpec files' })
    await expect(push).not.toBeChecked()
    await expect(push).toHaveAccessibleDescription(/may be pushed with a task’s branch/)
    await expect(c.getByText('Blocked')).toBeVisible()
    await userEvent.click(c.getByRole('switch', { name: 'Write OpenSpec artifacts' }))
    await expect(args.onChange).toHaveBeenCalledWith('writeOpenSpec', true)
    await expect(push).not.toBeChecked()
    await userEvent.click(push)
    await expect(args.onChange).toHaveBeenCalledWith('pushProtected', true)
    await expect(c.getByText('Allowed')).toBeVisible()
  },
}

/** Each allowed. */
export const AllAllowed: Story = { args: { value: { writeSkills: true, writeOpenSpec: true, pushProtected: true } } }

/** One that didn't hold says why. */
export const Failed: Story = { args: { error: 'The rules changed since you looked. Look again, then switch it.' } }

/* In the project's settings: a module that says where they stand, which opens out to them. */
function Settings(args: RepositoryFilesProps) {
  const [open, setOpen] = useState<'all' | 'files'>('all')
  const [value, setValue] = useState(args.value)
  return (
    <ControlCenter
      defaultOpen
      trigger={
        <Button size="small" variant="quiet" icon="gear">
          Settings
        </Button>
      }
      text={{ label: 'Meridian’s settings' }}
    >
      {open === 'all' ? (
        <ControlGrid>
          <ControlModule title="Repository files" onClick={() => setOpen('files')}>
            <ControlWords title={repositoryFilesText.summary(value)} />
          </ControlModule>
        </ControlGrid>
      ) : (
        <ControlDetail title="Repository files" onBack={() => setOpen('all')}>
          <ControlSheet>
            <RepositoryFiles value={value} onChange={(file, on) => setValue((was) => ({ ...was, [file]: on }))} />
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}

/** In the project's settings, under its button: the module says where they stand and opens out to the switches. */
export const InSettings: Story = {
  render: (args) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 520, padding: 16 }}>
      <Settings {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = within(await page.findByRole('dialog', { name: 'Meridian’s settings' }))
    await expect(panel.getByText('Kept on this computer, pushing blocked')).toBeInTheDocument()
    await userEvent.click(panel.getByRole('button', { name: /^Repository files/ }))
    await expect(panel.getByRole('heading', { name: 'Repository files', level: 2 })).toHaveFocus()
    await expect(panel.getAllByRole('switch')).toHaveLength(3)
  },
}
