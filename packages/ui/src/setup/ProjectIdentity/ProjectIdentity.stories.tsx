import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { Button } from '../../primitives/Button/Button'
import { States } from '../../storybook/States'
import {
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlMarks,
  ControlModule,
  ControlSheet,
  ControlWords,
} from '../ControlCenter/ControlCenter'
import { ProjectIdentity, type ProjectIdentityProps, projectIdentityText } from './ProjectIdentity'

/* The other projects on this Mac, by the ink each has. */
const TAKEN = { [ProjectInk.Clay]: 'Halyard', [ProjectInk.Moss]: 'Tessera', [ProjectInk.Ochre]: 'Ferrous' }

/* As a consumer keeps it: a new name or ink shows at once. */
function Kept(args: ProjectIdentityProps) {
  const [name, setName] = useState(args.name)
  const [ink, setInk] = useState(args.ink)
  return (
    <ProjectIdentity
      {...args}
      name={name}
      ink={ink}
      onRename={(next) => {
        setName(next)
        args.onRename(next)
      }}
      onInk={(next) => {
        setInk(next)
        args.onInk(next)
      }}
    />
  )
}

/* On the panel's lighter sheet, at the panel's width, as it sits in the project's settings. */
function Sheet({ children }: { children: ReactNode }) {
  return <div style={{ width: 416, padding: '14px 16px', borderRadius: 15, background: 'var(--frost-raised)' }}>{children}</div>
}

const meta = {
  title: 'Setup/ProjectIdentity',
  component: ProjectIdentity,
  args: { name: 'Meridian', seed: 'meridian', ink: ProjectInk.Teal, taken: TAKEN, onRename: fn(), onInk: fn() },
  render: (args) => (
    <Sheet>
      <Kept {...args} />
    </Sheet>
  ),
} satisfies Meta<typeof ProjectIdentity>
export default meta
type Story = StoryObj<typeof meta>

/** Its mark, its name and its colour; a swatch another project has says whose it is. */
export const AsItIs: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('textbox', { name: 'Name' })).toHaveValue('Meridian')
    await expect(c.getByRole('radio', { name: 'Teal' })).toBeChecked()
    await expect(c.getByRole('radio', { name: 'Clay, Halyard’s' })).not.toBeChecked()
  },
}

/** Renamed in place: Enter keeps the name, trimmed, and focus leaving keeps it too. */
export const Renaming: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.type(field, '  Refunds v2 {Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('Refunds v2')
    await expect(field).toHaveValue('Refunds v2')
    await userEvent.type(field, ' API')
    await userEvent.tab()
    await expect(args.onRename).toHaveBeenLastCalledWith('Refunds v2 API')
  },
}

/** Enter that finishes what an input method is composing is the input method's; the next one keeps the name. */
export const Composing: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Name' })
    await userEvent.type(field, ' 2')
    await fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    await fireEvent.keyDown(field, { key: 'Escape', isComposing: true })
    await expect(args.onRename).not.toHaveBeenCalled()
    await expect(field).toHaveValue('Meridian 2')
    await userEvent.keyboard('{Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('Meridian 2')
  },
}

/** Escape puts back what was typed; the same name again changes nothing. */
export const PuttingItBack: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Name' })
    await userEvent.type(field, ' and more')
    await expect(field).toHaveAttribute('data-own-escape')
    await userEvent.keyboard('{Escape}')
    await expect(field).toHaveValue('Meridian')
    await expect(field).not.toHaveAttribute('data-own-escape')
    await userEvent.type(field, '{Enter}')
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

/** Cleared, Enter says it needs a name; focus leaving puts the name back. */
export const NoName: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('alert')).toHaveTextContent('Give the project a name.')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await userEvent.tab()
    await expect(field).toHaveValue('Meridian')
    await expect(c.queryByRole('alert')).toBeNull()
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

/** Another ink, by a press or the arrows; the mark is drawn in it at once. */
export const ChoosingAnInk: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: 'Rose' }))
    await expect(args.onInk).toHaveBeenCalledWith(ProjectInk.Rose)
    await expect(c.getByRole('radio', { name: 'Rose' })).toHaveFocus()
    // Radix moves focus on a timeout and chooses only while the arrow is held, as a person's key is: press, wait, release.
    await userEvent.keyboard('{ArrowRight>}')
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.keyboard('{/ArrowRight}')
    await waitFor(() => expect(args.onInk).toHaveBeenLastCalledWith(ProjectInk.Brick))
    await expect(c.getByRole('radio', { name: 'Brick' })).toBeChecked()
  },
}

/** A change that didn't hold says why. */
export const Failed: Story = { args: { error: 'That project isn’t there any more.' } }

/** A long name scrolls in its field. */
export const LongName: Story = { args: { name: 'Payments platform, refunds and partner webhooks (2026 rewrite)' } }

/*
 * The project's settings as the app composes them: a module for its name and
 * colour, which opens out to change them in place, one for each thing that
 * opens elsewhere, and taking it out of Althar at the foot.
 */
function Settings(args: ProjectIdentityProps) {
  const [open, setOpen] = useState<'all' | 'name'>('all')
  const [name, setName] = useState(args.name)
  const [ink, setInk] = useState(args.ink)
  return (
    <ControlCenter
      defaultOpen
      trigger={
        <Button size="small" variant="quiet" icon="gear">
          Settings
        </Button>
      }
      onEscapeKeyDown={(event) => {
        // Escape steps back out of the opened module before it closes the panel, once a field has had its own.
        if (event.defaultPrevented || open === 'all') return
        event.preventDefault()
        setOpen('all')
      }}
      text={{ label: 'Meridian’s settings' }}
    >
      {open === 'all' ? (
        <>
          <ControlGrid>
            <ControlModule title="Name and colour" onClick={() => setOpen('name')}>
              <ControlWords mark={<ProjectMark seed={args.seed} ink={ink} size={30} />} title={name} line={projectIdentityText.inks[ink]} />
            </ControlModule>
            <ControlModule title="Repositories" aside="3" place={{ column: [1, 3] }} onClick={fn()}>
              <ControlMarks marks={[{ id: 'github', name: 'GitHub', brand: Brand.GitHub }]} />
            </ControlModule>
            <ControlModule title="GitHub" place={{ column: [3, 5] }} onClick={fn()}>
              <ControlWords title="Connected" line="as balazs" />
            </ControlModule>
            <ControlModule title="Rules" onClick={fn()}>
              <ControlWords
                title="The coordinator decides"
                line="Always asks you: deploying and publishing, pushing to the default branch."
              />
            </ControlModule>
          </ControlGrid>
          <ControlFoot>
            <Button size="small" variant="danger" icon="close">
              Remove from Althar
            </Button>
          </ControlFoot>
        </>
      ) : (
        <ControlDetail title="Name and colour" onBack={() => setOpen('all')}>
          <ControlSheet>
            <ProjectIdentity {...args} name={name} ink={ink} onRename={setName} onInk={setInk} />
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}

/** In the project's settings, under its button: the module opens out, a rename is kept in place, and Escape steps back. */
export const InSettings: Story = {
  render: (args) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 520, padding: 16 }}>
      <Settings {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = within(await page.findByRole('dialog', { name: 'Meridian’s settings' }))
    await userEvent.click(panel.getByRole('button', { name: /^Name and colour/ }))
    await expect(panel.getByRole('heading', { name: 'Name and colour', level: 2 })).toHaveFocus()
    const field = panel.getByRole('textbox', { name: 'Name' })
    await userEvent.type(field, ' P')
    // The first Escape puts the name back, and leaves the panel where it is.
    await userEvent.keyboard('{Escape}')
    await expect(field).toHaveValue('Meridian')
    await userEvent.type(field, ' P{Enter}')
    await userEvent.click(panel.getByRole('radio', { name: 'Rose' }))
    await userEvent.keyboard('{Escape}')
    await expect(panel.getByRole('button', { name: /^Name and colour/ })).toHaveFocus()
    await expect(panel.getByRole('button', { name: /^Name and colour/ })).toHaveTextContent('Meridian PRose')
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'rest', node: <Kept {...args} /> },
        { state: 'failed', node: <Kept {...args} error="That project isn’t there any more." /> },
        { state: 'another ink', node: <Kept {...args} ink={ProjectInk.Clay} /> },
        { state: 'long name', node: <Kept {...args} name="Payments platform, refunds and partner webhooks (2026 rewrite)" /> },
      ].map((cell) => ({ ...cell, node: <Sheet>{cell.node}</Sheet> }))}
    />
  ),
}
