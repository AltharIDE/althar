import type { Meta, StoryObj } from '@storybook/react-vite'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { McpCall, WebFetch, WebReads, WebSearch } from './External'
import { States, statesParameters } from '../../storybook/States'

const RFC = 'https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3'

const meta = {
  title: 'Thread/External',
  component: WebFetch,
  decorators: [threadDecorator],
  args: {
    title: 'RFC 9110 · 10.2.3 Retry-After',
    url: RFC,
    excerpt: 'The value of this field can be either an HTTP-date or a number of seconds to delay after receiving the response.',
  },
} satisfies Meta<typeof WebFetch>
export default meta
type Story = StoryObj<typeof meta>

export const PageRead: Story = {}
export const PageReadOpen: Story = { args: { defaultOpen: true } }
export const PagesRead: Story = {
  render: () => (
    <WebReads
      defaultOpen
      pages={[
        { title: 'RFC 9110 · 10.2.3 Retry-After', url: RFC },
        { title: '429 Too Many Requests', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429' },
        { title: 'Rate limits', url: 'https://docs.stripe.com/rate-limits' },
        { title: 'Handling rate limits', url: 'https://docs.adyen.com/development-resources/rate-limits' },
      ]}
    />
  ),
}
export const Search: Story = {
  render: () => (
    <WebSearch
      defaultOpen
      query="Retry-After seconds or HTTP date 429"
      results={[
        { title: 'RFC 9110 · HTTP Semantics · 10.2.3 Retry-After', host: 'rfc-editor.org' },
        { title: '429 Too Many Requests · HTTP', host: 'developer.mozilla.org' },
        { title: 'Rate limits · API reference', host: 'docs.stripe.com' },
      ]}
    />
  ),
}
export const Mcp: Story = {
  render: () => (
    <McpCall
      defaultOpen
      server="Linear"
      tool="get_issue"
      args={'"MER-212"'}
      result={{
        summary: 'MER-212 · In progress',
        fields: [
          ['Title', 'Partner limits for refunds'],
          ['Status', 'In progress'],
          ['Asked by', 'Partner success · Acme'],
          ['Due', '2.14'],
        ],
      }}
    />
  ),
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        ...(['folded', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state,
          force: state === 'folded' ? undefined : state,
          node: <WebFetch {...args} />,
        })),
        { state: 'open', node: <WebFetch {...args} defaultOpen /> },
        {
          state: 'pages',
          node: (
            <WebReads
              pages={[
                { title: 'Rate limits', url: 'https://docs.stripe.com/rate-limits' },
                { title: '429', url: 'https://developer.mozilla.org/429' },
              ]}
            />
          ),
        },
        { state: 'search', node: <WebSearch query="Retry-After seconds" results={[{ title: 'RFC 9110', host: 'rfc-editor.org' }]} /> },
        {
          state: 'mcp',
          node: (
            <McpCall
              server="Linear"
              tool="get_issue"
              args={'"MER-212"'}
              result={{ summary: 'In progress', fields: [['Status', 'In progress']] }}
            />
          ),
        },
      ]}
    />
  ),
}
