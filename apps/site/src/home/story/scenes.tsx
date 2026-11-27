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
  workers: {
    title: (
      <>
        One worker.
        <br />
        <b>Then a fleet.</b>
      </>
    ),
    lead: 'In early access: add Linux machines of yours as workers, and your tasks’ agents run there, with their setup, tests and dev servers. The commits come back to your computer.',
  },
  community: {
    title: (
      <>
        Built in the open. <b>Built with you.</b>
      </>
    ),
    lead: 'Ask how anything works, hear what’s coming before it ships, and tell the people who build Althar what you need next.',
  },
  review: {
    title: (
      <>
        Copy and pasting.
        <br />
        <b>No more.</b>
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
    lead: 'Run many agents at once from one shared context, and let the work carry on while you’re away.',
  },
  connections: {
    title: (
      <>
        Works with <b>what you already use.</b>
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

/**
 * The board scene's heading for each of its views, in the views' order
 * (Views.tsx): the board, with the coordinator's conversation beside it; the
 * home, across projects; and a canvas. The scene shows the one for the view
 * in front.
 */
export const VIEW_HEADS = [
  SCENE.independent,
  {
    title: (
      <>
        Every project.
        <br />
        <b>One home.</b>
      </>
    ),
    lead: 'A permission, a change to accept, a decision: what needs you across every project waits in one place. Answer each right there, while the rest keep running.',
  },
  {
    title: (
      <>
        Say what you want.
        <br />
        <b>See it drawn.</b>
      </>
    ),
    lead: 'Leads draw pages, mockups and diagrams on a canvas beside the conversation. Ask for a change, and the next version answers it.',
  },
] as const

/** The last line, by the download: its quiet half, then its heavy one. */
/**
 * The review's facts, beside its drawing, each coming in as the drawing gets
 * to it: the second lab's review, the rounds until it's clean, and what
 * reaches you.
 */
/** Today, by hand: what each paste in the review's drawing does, in turn (Patch.tsx shows them as the lines taken out, under their comment). */
/** The flow's three acts, in the lead's order, and the two features (Bento.tsx's tiles, by id) that make each. The rest of the tiles come after, smaller. */
export const FLOW_ACTS = [
  { name: 'Many agents at once', tiles: ['accounts', 'worktrees'] },
  { name: 'One shared context', tiles: ['workspaces', 'skills'] },
  { name: 'It keeps going while you’re away', tiles: ['automations', 'conflicts'] },
] as const
export const FLOW_REST = ['canvas', 'voice', 'queue', 'servers', 'load', 'storage'] as const

export const REVIEW_TODAY_NOTE = 'Today, you carry every answer from one agent to the other.'
export const REVIEW_TODAY = [
  'Paste the change into another agent for review',
  'Paste its findings back to the first',
  'Paste the fix across for another look',
  'Paste “clean” back. Then again, for the next change',
] as const

export const REVIEW_FACTS = [
  {
    title: 'A second lab reviews every change',
    body: 'By default, what one lab’s model writes is read by a model from another: Claude’s work by Gemini or GPT, theirs by Claude, or any of it by an open-weight model. A step can have two reviewers at once, each with its own eyes on it.',
  },
  {
    title: 'Fixed until it’s clean',
    body: 'The lead fixes each finding, or sets it aside and says why. Then the review goes round again, each round building on the last with your original criteria in hand: a fix can’t quietly bring back an earlier problem.',
  },
  {
    title: 'Only clean work reaches you',
    body: 'You see the pull request once its review is clean and its checks pass, every finding kept at the lines it’s about with what the lead did about it. Your project’s rules add their own steps, like a security review whenever money is touched, and you still decide what merges.',
  },
] as const

/**
 * The community's Discord, as Community.tsx draws it: its channels, and a
 * conversation in #general. The people asking are invented, as the demo
 * projects are, and only ask; what Niko and Balazs answer is true of Althar
 * today, or (Althar Cloud) what the brand says comes next.
 */
interface ChatLine {
  who: string
  /** A member's avatar colour; the team's is Althar's own. */
  hue?: string
  at: string
  text: string
  reactions?: readonly (readonly [string, number])[]
}
interface Channel {
  name: string
  open?: boolean
  unread?: boolean
  voice?: boolean
}

export const COMMUNITY: {
  label: string
  topic: string
  team: readonly string[]
  channels: readonly { name: string; items: readonly Channel[] }[]
  chat: readonly ChatLine[]
} = {
  label:
    'Althar’s Discord server, #general: Niko and Balazs, who build Althar, announce 0.9.0 and answer questions about choosing a reviewer, running out of a plan, skills, the built-in browser and Althar Cloud',
  topic: 'Ask anything about Althar',
  team: ['Niko B', 'Balazs O'],
  channels: [
    { name: 'Information', items: [{ name: 'announcements' }, { name: 'changelog' }] },
    {
      name: 'Community',
      items: [
        { name: 'general', open: true },
        { name: 'help', unread: true },
        { name: 'show-and-tell' },
        { name: 'feature-requests', unread: true },
      ],
    },
    { name: 'Voice', items: [{ name: 'office-hours', voice: true }] },
  ],
  chat: [
    {
      who: 'Niko B',
      at: 'Today at 2:02 PM',
      text: '0.9.0 is out. Take back a message you sent a task: the turns after it and the files they changed go back as they were.',
      reactions: [
        ['🎉', 14],
        ['🙌', 6],
      ],
    },
    { who: 'priya.s', hue: '#8a5a3c', at: 'Today at 2:04 PM', text: 'Can I pick who reviews a change, or is it always another lab?' },
    {
      who: 'Balazs O',
      at: 'Today at 2:05 PM',
      text: 'Another lab by default: Claude’s work is read by Gemini or GPT, theirs by Claude. Change the reviewer on any step before the plan starts.',
    },
    { who: 'tomasz', hue: '#4f6b52', at: 'Today at 2:07 PM', text: 'What happens when my Claude plan runs out halfway through a task?' },
    {
      who: 'Niko B',
      at: 'Today at 2:07 PM',
      text: 'It carries on with the next account or agent with room, on the same thread and the same branch. Add every plan you have, in the order you want them used.',
      reactions: [['👀', 4]],
    },
    { who: 'jules_k', hue: '#6a4d7a', at: 'Today at 2:09 PM', text: 'Do I need to add a skill to each agent separately?' },
    { who: 'Balazs O', at: 'Today at 2:09 PM', text: 'Once. Claude Code, Codex and OpenCode all get it.' },
    { who: 'mara.dev', hue: '#3f5f78', at: 'Today at 2:11 PM', text: 'Can the lead check its own UI work?' },
    {
      who: 'Niko B',
      at: 'Today at 2:12 PM',
      text: 'In the built-in browser: it clicks, types and takes screenshots in your task’s app to check what it built. Point at anything there and comment, and it answers.',
    },
    { who: 'devon', hue: '#7a6a3a', at: 'Today at 2:14 PM', text: 'What’s next after the desktop app?' },
    {
      who: 'Balazs O',
      at: 'Today at 2:15 PM',
      text: 'Althar Cloud: designers, PMs and QA in the same project, on the same shared memory, with more compute and CI built for the volume agents create.',
      reactions: [
        ['🔥', 11],
        ['🚀', 7],
      ],
    },
  ],
}

export const END = ['The craft of a paid app.', 'The freedom of open source.'] as const

/** The race, before the board: chasing the best model, then Althar above the race. */
export const RACE = {
  before: {
    title: (
      <>
        You chase the best model.
        <br />
        You start over{' '}
        <b>
          every time
          {/* Its period is the first screen's pointer dot, landing here as the pointer leaves the first screen (hero/feed.ts). */}
          <span data-period="">.</span>
        </b>
      </>
    ),
    lead: 'Eight new top models in nine months, from more than one lab. Each time you follow the leader, the context you built up stays behind in the last tool.',
    label:
      'A timeline of 2026 with eight new top models from OpenAI and Anthropic. Above it, the context you build up grows, then drops to nothing each time you move to a new tool: Codex in February, Claude Code in April, OpenCode in August.',
  },
  after: {
    title: (
      <>
        Models come and go.
        <br />
        <b>Your project stays.</b>
      </>
    ),
    lead: 'Althar sits above the race. Your context lives with the project; each new model branches in, does its work and moves on, and nothing at the core goes with it.',
    label:
      'Althar at the top, holding your project’s context: repo rules, decisions, the plan, review notes and the open task. Below it a single line runs down, and each new model branches off it for a while, then fades as the next arrives. At the end the models gather into orbits around Althar.',
  },
  end: (
    <>
      The centre of your workflow. <b>Any model you run.</b>
    </>
  ),
  key: ['Context you’ve built up', 'Left behind at a switch'],
} as const
