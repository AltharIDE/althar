import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../Button/Button'
import { Menu, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, type MenuProps } from './Menu'
import { States, statesParameters } from '../../storybook/States'

const EFFORTS = ['Low', 'Medium', 'High', 'Max']

function EffortMenu(props: Partial<MenuProps>) {
  const [effort, setEffort] = useState('High')
  return (
    <Menu
      label="Effort"
      width={220}
      trigger={
        <Button>
          Effort: {effort} <Icon name="chevronD" size={10} />
        </Button>
      }
      {...props}
    >
      <MenuRadioGroup label="Effort" value={effort} onChange={setEffort}>
        {EFFORTS.map((e) => (
          <MenuRadioItem key={e} value={e} hint={e === 'Max' ? 'slower' : undefined}>
            {e}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon="gear" onSelect={() => {}}>
        Set the default
      </MenuItem>
      <MenuItem icon="lock" disabled onSelect={() => {}}>
        Lock for this task
      </MenuItem>
    </Menu>
  )
}

const meta = {
  title: 'Primitives/Menu',
  component: Menu,
  args: { label: 'Effort', trigger: <Button>Effort</Button>, children: null },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 280 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Menu>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: () => <EffortMenu />,
}

/** Opened with Enter, a letter jumps to its item, Enter chooses and focus returns. */
export const ChoosingByKeyboard: Story = {
  render: () => <EffortMenu />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    const button = c.getByRole('button', { name: /Effort: High/ })
    button.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await page.findByRole('menu', { name: 'Effort' })
    /* it fades in from nothing */
    await waitFor(() => expect(menu).toBeVisible())
    await waitFor(() => expect(page.getByRole('menuitemradio', { name: 'Low' })).toHaveFocus())
    await userEvent.keyboard('m')
    await expect(page.getByRole('menuitemradio', { name: /Medium/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull())
    await expect(c.getByRole('button', { name: /Effort: Medium/ })).toHaveFocus()
  },
}

/** Every kind of item: a choice that is current, one that is not, a command with an icon, a hint and a shortcut, and one that is disabled. */
export const Open: Story = { render: () => <EffortMenu defaultOpen /> }

/** The highlighted item, reached with the arrow keys. */
export const Highlighted: Story = {
  render: () => <EffortMenu defaultOpen />,
  play: async () => {
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  },
}

export const WithGroups: Story = {
  render: () => (
    <Menu label="Message" defaultOpen trigger={<Button icon="more">More</Button>}>
      <MenuGroup label="Share">
        <MenuItem icon="copy" kbd="⌘C" onSelect={() => {}}>
          Copy as markdown
        </MenuItem>
        <MenuItem icon="quote" onSelect={() => {}}>
          Quote in reply
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon="search" hint="12" onSelect={() => {}}>
        All models
      </MenuItem>
    </Menu>
  ),
}

/** At the bottom right of the screen, it opens upward and inward to stay visible. */
export const AtTheEdge: Story = {
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', height: '100vh', padding: 8 }}>
        <Story />
      </div>
    ),
  ],
  render: () => <EffortMenu defaultOpen />,
}

/*
 * The button in each state, and beside it a menu open with every kind of
 * item: current, highlighted (forced on the second), disabled, with a hint
 * and with a shortcut. The menu is portalled, so its forced state is aimed
 * at it by name.
 */
export const AllStates: Story = {
  parameters: {
    pseudo: {
      ...statesParameters.pseudo,
      hover: [...statesParameters.pseudo.hover, '[aria-label="Item states"] [role="menuitemradio"]:nth-of-type(2)'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 320 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 24 }}>
      <States
        cells={[
          ...(['rest', 'hover', 'focus', 'pressed'] as const).map((state) => ({ state, node: <EffortMenu /> })),
          { state: 'disabled', node: <Button disabled>Effort</Button> },
        ]}
      />
      <div>
        <Menu label="Item states" defaultOpen trigger={<Button>Items</Button>} width={240}>
          <MenuRadioGroup label="Effort" value="Low" onChange={() => {}}>
            <MenuRadioItem value="Low">Current</MenuRadioItem>
            <MenuRadioItem value="Medium">Highlighted</MenuRadioItem>
            <MenuRadioItem value="High" hint="slower">
              With a hint
            </MenuRadioItem>
            <MenuRadioItem value="Max" disabled>
              Disabled
            </MenuRadioItem>
            <MenuRadioItem value="Auto" description="Picks per step: more for reviews, less for reads and small edits">
              With a description
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon="copy" kbd="⌘C" onSelect={() => {}}>
            With a shortcut
          </MenuItem>
        </Menu>
      </div>
    </div>
  ),
}
