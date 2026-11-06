import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { fn } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { WindowButtons, type WindowButtonsLook, type WindowButtonsTone } from './WindowButtons'

const meta = {
  title: 'Chrome/WindowButtons',
  component: WindowButtons,
  args: { onClose: fn(), onMinimize: fn(), onToggleMaximize: fn() },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WindowButtons>
export default meta
type Story = StoryObj<typeof meta>

/** Althar's own: the dots a Mac shows, the glyphs on hover. */
export const Rest: Story = {}
/** The third button says restore when the window is maximized. */
export const Maximized: Story = { args: { maximized: true } }

/** GNOME, from 40 on: round, flat, a faint disc at rest. */
export const Gnome: Story = { args: { look: 'gnome', tone: 'adwaita' } }
/** GNOME's own default: close alone. */
export const GnomeCloseOnly: Story = { args: { look: 'gnome', tone: 'adwaita', buttons: ['close'] } }
/** GTK 3's themes, and the neutral fallback on a desktop Althar doesn't know: a disc only as one is pointed at. */
export const GnomeLegacy: Story = { args: { look: 'gnome', tone: 'legacy' } }
/** Ubuntu's Yaru: close turns orange as it is pointed at. */
export const GnomeYaru: Story = { args: { look: 'gnome', tone: 'yaru' } }
/** KDE's Breeze: a chevron down to minimize, up to maximize, a soft red disc under close, its glyph dark. */
export const Kde: Story = { args: { look: 'kde' } }
/** Maximized on KDE: the diamond restores. */
export const KdeMaximized: Story = { args: { look: 'kde', maximized: true } }
/** Windows: caption buttons the bar's full height. */
export const Windows: Story = {
  args: { look: 'windows' },
  decorators: [(Story) => <div style={{ display: 'flex', height: 32, background: 'var(--chrome)' }}>{Story()}</div>],
}

export const GnomeDark: Story = { ...Gnome, globals: { theme: 'dark' } }
export const KdeDark: Story = { ...Kde, globals: { theme: 'dark' } }
export const WindowsDark: Story = { ...Windows, globals: { theme: 'dark' } }

const LOOKS: ReadonlyArray<{ name: string; look: WindowButtonsLook; tone?: WindowButtonsTone }> = [
  { name: 'gnome', look: 'gnome', tone: 'adwaita' },
  { name: 'gnome legacy', look: 'gnome', tone: 'legacy' },
  { name: 'yaru', look: 'gnome', tone: 'yaru' },
  { name: 'kde', look: 'kde' },
  { name: 'windows', look: 'windows' },
]

/* The state lands on close, the button whose hover changes most. */
const onClose = statesOn({
  hover: 'button[aria-label="Close the window"]',
  focus: 'button[aria-label="Close the window"]',
  pressed: 'button[aria-label="Close the window"]',
})

/** Each look at rest, with close pointed at, focused by the keyboard and pressed, and maximized. */
export const AllStates: Story = {
  parameters: onClose,
  render: (args) => (
    <States
      size="wide"
      cells={LOOKS.flatMap(({ name, look, tone }) => {
        const props = { ...args, look, ...(tone === undefined ? {} : { tone }) }
        const bar = (node: ReactNode) => (
          <div style={{ display: 'flex', height: 32, background: 'var(--chrome)', paddingInline: 8 }}>{node}</div>
        )
        return [
          { state: `${name} · rest`, node: bar(<WindowButtons {...props} />) },
          { state: `${name} · hover close`, force: 'hover' as const, node: bar(<WindowButtons {...props} />) },
          { state: `${name} · focus close`, force: 'focus' as const, node: bar(<WindowButtons {...props} />) },
          { state: `${name} · pressed close`, force: 'pressed' as const, node: bar(<WindowButtons {...props} />) },
          { state: `${name} · maximized`, node: bar(<WindowButtons {...props} maximized />) },
        ]
      })}
    />
  ),
}

export const AllStatesDark: Story = { ...AllStates, globals: { theme: 'dark' } }
