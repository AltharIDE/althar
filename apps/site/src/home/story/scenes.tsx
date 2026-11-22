/*
 * What each scene of the home page says: its claim, the claim's heavy half
 * in bold, and its lead; and the last line, by the download.
 */

/** What each scene says: its claim and its lead, by the scene's id. */
export const SCENE = {
  independent: {
    title: (
      <>
        Every agent’s work.
        <br />
        <b>One board.</b>
      </>
    ),
    lead: 'Up next, running, needs you, settled: every task across Claude Code, Codex, Gemini and Qwen, in one place. When one agent runs out, another takes over.',
  },
  coordinator: {
    title: (
      <>
        Every project
        <br />
        <b>has a manager.</b>
      </>
    ),
    lead: 'It’s called the coordinator. It knows your whole project, and puts a team of agents on every ask.',
  },
  review: {
    title: (
      <>
        No more <b>meat proxying.</b>
      </>
    ),
    lead: 'Every change is reviewed by a model from another lab, and fixed until it’s clean.',
  },
  flow: {
    title: (
      <>
        Fall in love
        <br />
        <b>with building again.</b>
      </>
    ),
    lead: 'Tired of juggling terminals, re-explaining your project and babysitting agents? So were we.',
  },
  connections: {
    title: (
      <>
        Works with
        <br />
        <b>what you already use.</b>
      </>
    ),
    lead: 'Code on GitHub, GitLab or Bitbucket. Issues in Linear, Jira, Trello or ClickUp. Anything else through an MCP server. Connect each once, and every agent can use it.',
  },
  edge: {
    title: (
      <>
        Wherever you are, <b>still in reach.</b>
      </>
    ),
    lead: 'Althar sits round your Mac’s notch, in whatever you’re doing: point at it to answer a permission or open a pull request, and carry on.',
  },
  gallery: {
    title: (
      <>
        Take a peek <b>inside.</b>
      </>
    ),
    lead: 'Real screens from the app, on its demo projects.',
  },
} as const

/** The last line, by the download: its quiet half, then its heavy one. */
export const END = ['The craft of a paid app.', 'The freedom of open source.'] as const
