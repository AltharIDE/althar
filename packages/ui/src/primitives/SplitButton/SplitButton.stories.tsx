import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactElement } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { States, statesOn, statesParameters } from '../../storybook/States'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../Menu/Menu'
import { SplitButton, type SplitButtonProps } from './SplitButton'

const MODELS = ['Opus 4.1', 'GPT-5', 'Gemini 2.5 Pro']

function Models({ trigger, onPick }: { trigger: ReactElement; onPick?: (m: string) => void }) {
  const [model, setModel] = useState(MODELS[0] ?? '')
  return (
    <Menu label="Continue with" align="end" width={240} trigger={trigger}>
      <MenuRadioGroup
        label="Continue with"
        value={model}
        onChange={(m) => {
          setModel(m)
          onPick?.(m)
        }}
      >
        {MODELS.map((m) => (
          <MenuRadioItem key={m} value={m}>
            {m}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

const menu = (trigger: ReactElement) => <Models trigger={trigger} />

const meta = {
  title: 'Primitives/SplitButton',
  component: SplitButton,
  args: { children: 'Continue with Opus 4.1', moreLabel: 'Choose another model', menu, onClick: fn() },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 180 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SplitButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Small: Story = { args: { size: 'small' } }
export const Disabled: Story = { args: { disabled: true } }
export const Busy: Story = { args: { busy: true, children: 'Switching' } }
/** The first way on an ask offers, in its violet. */
export const Signal: Story = { args: { variant: 'signal' } }

/** The button does the likely thing; the chevron opens the others, and Escape brings focus back to it. */
export const ChoosingAnother: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Continue with Opus 4.1' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
    const more = c.getByRole('button', { name: 'Choose another model' })
    await userEvent.click(more)
    await page.findByRole('menu', { name: 'Continue with' })
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull())
    await expect(more).toHaveFocus()
  },
}

const row = (props: Partial<SplitButtonProps>) =>
  ['rest', 'hover', 'focus', 'pressed'].map((state) => ({
    state,
    node: (
      <SplitButton moreLabel="Choose another model" menu={menu} {...props}>
        {props.children ?? 'Continue with Opus 4.1'}
      </SplitButton>
    ),
  }))

/** The chevron's own hover, focus and pressed. */
export const ChevronStates: Story = {
  parameters: statesOn({ hover: 'button:last-child', focus: 'button:last-child', pressed: 'button:last-child' }),
  render: () => <States cells={row({})} size="wide" />,
}

/** Every state, at both sizes. Hover, focus and pressed are forced on the button; ChevronStates forces them on the chevron. */
export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <States
        cells={[
          ...row({}),
          {
            state: 'disabled',
            node: (
              <SplitButton moreLabel="Choose another model" menu={menu} disabled>
                Continue with Opus 4.1
              </SplitButton>
            ),
          },
          {
            state: 'busy',
            node: (
              <SplitButton moreLabel="Choose another model" menu={menu} busy>
                Switching
              </SplitButton>
            ),
          },
        ]}
        size="wide"
      />
      <States cells={row({ size: 'small' })} size="wide" />
      <States cells={row({ variant: 'signal' })} size="wide" />
    </div>
  ),
}
