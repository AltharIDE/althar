import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PAGE, PHONE_PAGE } from '../../fixtures/pages'
import { PageFrame } from '../PageFrame/PageFrame'
import { PageLine, PagePanel } from './PagePanel'

const VIEWPORTS = [
  { value: 'fit', label: 'Fit the panel' },
  { value: 'desktop', label: 'Desktop', hint: '1440 × 900' },
  { value: 'laptop', label: 'Laptop', hint: '1280 × 800' },
  { value: 'tablet', label: 'Tablet', hint: '820 × 1180' },
  { value: 'phone', label: 'Phone', hint: '390 × 844' },
] as const

type Viewport = (typeof VIEWPORTS)[number]['value']

const meta = {
  title: 'Browser/PagePanel',
  component: PagePanel<Viewport>,
  parameters: { layout: 'fullscreen' },
  args: {
    address: 'localhost:5173/refunds',
    full: 'http://localhost:5173/refunds',
    canBack: true,
    canForward: false,
    onBack: fn(),
    onForward: fn(),
    onReload: fn(),
    onStop: fn(),
    onNavigate: fn(),
    keep: 'until the task is done',
    onChangeKeep: fn(),
    onClear: fn(),
    viewport: 'fit',
    viewports: VIEWPORTS,
    onViewport: fn(),
    onComment: fn(),
    commentKey: '⇧⌘C',
    onOutside: fn(),
    docked: 'beside',
    onDock: fn(),
    onClose: fn(),
    children: <PageFrame still={PAGE} />,
  },
} satisfies Meta<typeof PagePanel<Viewport>>
export default meta
type Story = StoryObj<typeof meta>

/* Where the panel lives: the workbench beside the conversation. */
const beside: Decorator = (Story) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 640px', height: '100vh' }}>
    <div />
    <Story />
  </div>
)

/** A task's run beside its conversation: back, forward, reload, the address in the task's session, Viewport, Comment, out, a tab, Close. */
export const Beside: Story = { decorators: [beside] }
export const BesideDark: Story = { ...Beside, globals: { theme: 'dark' } }

/** Loading: reload becomes stop. */
export const Loading: Story = { args: { loading: true }, decorators: [beside] }

/** Pointing at the page to comment: Comment is pressed. */
export const Pointing: Story = { args: { pointing: true }, decorators: [beside] }

/** At a phone's size, drawn whole in a well; the button says the size. */
export const AtAPhone: Story = {
  args: {
    viewport: 'phone',
    children: <PageFrame page={{ x: 125, y: 16, width: 390 * 0.9, height: 844 * 0.9 }} still={PHONE_PAGE} />,
  },
  decorators: [beside],
}
export const AtAPhoneDark: Story = { ...AtAPhone, globals: { theme: 'dark' } }

/** Viewport, opened: the panel's own size, or a desktop's, a laptop's, a tablet's or a phone's. */
export const ViewportMenu: Story = {
  decorators: [beside],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Viewport' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitemradio', { name: /Phone/ })).toBeInTheDocument()
  },
}
export const ViewportMenuDark: Story = { ...ViewportMenu, globals: { theme: 'dark' } }

/** The page's session, on request: what it is kept apart from, how long its cookies stay, with Change, and what it never gets. */
export const Session: Story = {
  decorators: [beside],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Its own session' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByText('Cookies kept until the task is done.')).toBeInTheDocument()
  },
}
export const SessionDark: Story = { ...Session, globals: { theme: 'dark' } }

/** A sign-in sent to the person's browser, said under the bar. */
export const SignInOutside: Story = {
  args: {
    address: 'althar.ai/changelog',
    full: 'https://althar.ai/changelog',
    line: <PageLine icon="external">Linear’s sign-in opened in your browser.</PageLine>,
  },
  decorators: [beside],
}

/** A permission the page asked for, refused, with a way to the person's browser. */
export const PermissionRefused: Story = {
  args: {
    line: (
      <PageLine icon="session" action={{ label: 'Open in your browser', onAction: fn() }} onDismiss={fn()}>
        localhost:5173 asked for the camera, which pages here don’t get.
      </PageLine>
    ),
  },
  decorators: [beside],
}
export const PermissionRefusedDark: Story = { ...PermissionRefused, globals: { theme: 'dark' } }

/** In a tab of its own, with the way back beside the conversation. */
export const InATab: Story = { args: { docked: 'tab' }, decorators: [(Story) => <div style={{ height: '100vh' }}>{Story()}</div>] }

/** A narrow panel: Comment keeps its glyph alone. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', height: '100vh' }}>
        <div />
        <Story />
      </div>
    ),
  ],
}
