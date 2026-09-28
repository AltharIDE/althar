import type { Meta, StoryObj } from '@storybook/react-vite'

import { ICON_NAMES, Icon } from './Icon'
import s from './Icon.stories.module.css'
import { States } from '../../storybook/States'

const meta = {
  title: 'Foundations/Icon',
  component: Icon,
  args: { name: 'check', size: 14 },
  argTypes: { name: { control: 'select', options: ICON_NAMES } },
} satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

export const One: Story = {}

/** Every icon in the set, at the three sizes the product uses. */
export const All: Story = {
  render: () => (
    <ul className={s.grid}>
      {ICON_NAMES.map((name) => (
        <li key={name} className={s.cell}>
          <span className={s.sizes}>
            <Icon name={name} size={11} />
            <Icon name={name} size={14} />
            <Icon name={name} size={20} />
          </span>
          <span className={s.name}>{name}</span>
        </li>
      ))}
    </ul>
  ),
}

/** One icon in each ink it is drawn in: primary, secondary, metadata, disabled, on a fill, on ink. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        {
          state: 'ink',
          node: (
            <span style={{ color: 'var(--t-1)' }}>
              <Icon name="pr" />
            </span>
          ),
        },
        {
          state: 'secondary',
          node: (
            <span style={{ color: 'var(--t-2)' }}>
              <Icon name="pr" />
            </span>
          ),
        },
        {
          state: 'metadata',
          node: (
            <span style={{ color: 'var(--t-3)' }}>
              <Icon name="pr" />
            </span>
          ),
        },
        {
          state: 'disabled',
          node: (
            <span style={{ color: 'var(--t-4)' }}>
              <Icon name="pr" />
            </span>
          ),
        },
        {
          state: 'live',
          node: (
            <span style={{ color: 'var(--live)' }}>
              <Icon name="terminal" />
            </span>
          ),
        },
        {
          state: 'on fill',
          node: (
            <span style={{ display: 'inline-flex', padding: 6, borderRadius: 7, background: 'var(--signal)', color: '#fff' }}>
              <Icon name="check" />
            </span>
          ),
        },
        {
          state: 'on ink',
          dark: true,
          node: (
            <span style={{ color: '#f2f0ea' }}>
              <Icon name="close" />
            </span>
          ),
        },
        {
          state: '11 · 14 · 20',
          node: (
            <>
              <Icon name="clock" size={11} />
              <Icon name="clock" size={14} />
              <Icon name="clock" size={20} />
            </>
          ),
        },
      ]}
    />
  ),
}
