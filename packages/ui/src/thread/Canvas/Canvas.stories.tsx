import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Markdown } from '../Markdown/Markdown'
import { ThreadShellProvider } from '../Shell/Shell'
import { CanvasLine } from './CanvasLine'
import { CanvasList } from './CanvasList'
import { CanvasPanel } from './CanvasPanel'
import s from './Canvas.module.css'

/*
 * One of the project's canvases (ADR-104): its line in the turn that drew it,
 * its panel beside the conversation at each kind, and the project's list.
 */

const meta = {
  title: 'Thread/Canvas',
  component: CanvasPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'sign-in',
    title: 'Sign-in, three directions',
    kind: 'markdown',
    version: 3,
    latest: 3,
    by: 'The lead of Sign-in redesign · 4 min ago',
    note: 'Tighter spacing, as asked',
    onVersion: fn(),
    onComment: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof CanvasPanel>
export default meta
type Story = StoryObj<typeof meta>

/* Where the panel lives: a column beside the thread, as wide as a page's. */
const beside: Decorator = (Story) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 600px', height: '100vh' }}>
    <div />
    <Story />
  </div>
)

const plan = `## Sign in

Three directions for the sign-in page, as the person asked: each keeps the email first and the provider buttons under it.

\`\`\`mermaid
flowchart LR
  Open[Open Althar] --> Email{Email known?}
  Email -- yes --> Code[Send a code]
  Email -- no --> Make[Make an account]
  Code --> In[Signed in]
  Make --> In
\`\`\`

- **A, quiet:** one field, one button, the providers folded.
- **B, split:** the field beside a picture of the app.
- **C, guided:** a step at a time, with a progress line.
`

/** A document, with a diagram drawn in it, at reading width. */
export const ADocument: Story = {
  args: { children: <Markdown source={plan} size="panel" /> },
  decorators: [beside],
}

/** An older version: the bar says a newer one is out, with Show. */
export const AnOlderVersion: Story = {
  args: { version: 2, latest: 3, newer: 3, note: 'Providers under the field', children: <Markdown source={plan} size="panel" /> },
  decorators: [beside],
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('v3 is out')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Show' }))
    await expect(args.onVersion).toHaveBeenCalledWith(3)
  },
}

const page = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px Inter, system-ui, sans-serif; background: #f4f2ec; color: #141417; display: grid; place-items: center; height: 100vh }
  .card { width: 320px; padding: 28px; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(60,50,30,.06), 0 10px 24px -12px rgba(60,50,30,.14) }
  h1 { font-size: 18px; margin: 0 0 4px } p { margin: 0 0 18px; color: #63636b }
  input { box-sizing: border-box; width: 100%; padding: 9px 11px; border: 1px solid #85858b; border-radius: 8px; font: inherit; margin-bottom: 10px }
  button { width: 100%; padding: 9px; border: 0; border-radius: 8px; background: #141417; color: #fff; font: inherit; font-weight: 600 }
</style></head><body><div class="card"><h1>Sign in to Althar</h1><p>We’ll send a code to your email.</p>
<input placeholder="you@company.com"><button>Send a code</button></div></body></html>`

/** A page: drawn edge to edge, by a view of its own the window lays over its place; here, a frame stands in. */
export const APage: Story = {
  args: {
    kind: 'html',
    title: 'Sign-in page',
    fill: true,
    onReload: fn(),
    children: <iframe title="Sign-in page" className={s.page} style={{ border: 0, width: '100%' }} srcDoc={page} />,
  },
  decorators: [beside],
}

/** A picture, at its own size on the page's ground. */
export const APicture: Story = {
  args: {
    kind: 'svg',
    title: 'Checkout funnel',
    name: 'checkout-funnel',
    version: 1,
    latest: 1,
    note: null,
    fill: true,
    children: (
      <div className={s.picture}>
        <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200" role="img" aria-label="Checkout funnel">
          <rect width="360" height="200" fill="#fff" />
          {[180, 132, 90, 54].map((width, at) => (
            <g key={width}>
              <rect
                x={40}
                y={24 + at * 40}
                width={width * 1.5}
                height={28}
                rx={6}
                fill={['#2b3bff', '#5563ff', '#8a94ff', '#bcc2ff'][at]}
              />
              <text x={48} y={43 + at * 40} fill="#fff" fontSize="12" fontFamily="Inter, sans-serif">
                {['Visited', 'Basket', 'Paid', 'Came back'][at]}
              </text>
            </g>
          ))}
        </svg>
      </div>
    ),
  },
  decorators: [beside],
}

/** Writing a comment on the words selected; the comments sent on it under the canvas. */
export const Commenting: Story = {
  args: {
    selected: 'B, split',
    comments: [
      { id: 'c1', version: 2, body: 'The providers should stay visible, not folded.', place: 'Whole canvas', answered: true },
      { id: 'c2', version: 3, body: 'C feels slow for people who know their email.', place: '“C, guided”', answered: false },
    ],
    children: <Markdown source={plan} size="panel" />,
  },
  decorators: [beside],
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Comment' }))
    const field = c.getByPlaceholderText('Comment on “B, split”')
    await userEvent.type(field, 'Try the picture on the left')
    await userEvent.click(c.getByRole('button', { name: 'Add to message' }))
    await expect(args.onComment).toHaveBeenCalledWith('Try the picture on the left')
  },
}

/** Still being read, and one that couldn't be. */
export const Loading: Story = { args: { loading: true }, decorators: [beside] }
export const ReadFailed: Story = { args: { error: 'Its files aren’t in Althar’s store on this computer.' }, decorators: [beside] }

/** A canvas's line in the turn that drew it, and one an agent opened; pressed, it opens beside the conversation. */
export const InTheThread: StoryObj<typeof CanvasLine> = {
  render: () => {
    const openCanvas = fn()
    return (
      <ThreadShellProvider value={{ openCanvas, openedCanvas: 'cnv_b' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, padding: 24 }}>
          <CanvasLine
            canvas={{ canvasId: 'cnv_a', name: 'sign-in', title: 'Sign-in, three directions', kind: 'markdown', version: 3 }}
            action="published"
            note="Tighter spacing, as asked"
          />
          <CanvasLine
            canvas={{ canvasId: 'cnv_b', name: 'sign-in-page', title: 'Sign-in page', kind: 'html', version: 1 }}
            action="opened"
          />
        </div>
      </ThreadShellProvider>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Open Sign-in page beside the conversation' })).toHaveAttribute('aria-pressed', 'true')
  },
}

/** The project's canvases, every lead's and the coordinator's together; and none yet. */
export const TheProjectsCanvases: StoryObj<typeof CanvasList> = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 760, padding: 24 }}>
      <CanvasList
        opened="cnv_b"
        onOpen={fn()}
        canvases={[
          {
            id: 'cnv_a',
            name: 'sign-in',
            title: 'Sign-in, three directions',
            kind: 'markdown',
            version: 3,
            by: 'The lead of Sign-in redesign',
            openComments: 1,
          },
          {
            id: 'cnv_b',
            name: 'sign-in-page',
            title: 'Sign-in page',
            kind: 'html',
            version: 2,
            by: 'The lead of Build sign-in',
            openComments: 0,
          },
          {
            id: 'cnv_c',
            name: 'architecture',
            title: 'How the runtime fits together',
            kind: 'mermaid',
            version: 5,
            by: 'The coordinator',
            openComments: 0,
          },
          {
            id: 'cnv_d',
            name: 'checkout-funnel',
            title: 'Checkout funnel',
            kind: 'svg',
            version: 1,
            by: 'The lead of Funnel report',
            openComments: 2,
          },
        ]}
      />
      <CanvasList canvases={[]} onOpen={fn()} />
    </div>
  ),
}
