/*
 * What the docs hold, while their look is chosen: the map of pages, each
 * with what it is for and the question a reader brings to it. Only one page
 * is written (When an account runs out); the rest are named so every
 * direction can lay out the whole map.
 */

export interface DocPage {
  slug: string
  name: string
  /** What it covers, in a line. */
  note: string
  /** The question someone new would ask, in their words. */
  q: string
  /** Mostly about what Althar does on its own. */
  implicit?: boolean
}

export interface DocGroup {
  id: string
  name: string
  note: string
  pages: readonly DocPage[]
}

/** The page every direction shows written out. */
export const HERE = 'account-runs-out'

export const GROUPS: readonly DocGroup[] = [
  {
    id: 'start',
    name: 'Start here',
    note: 'From the download to your first task',
    pages: [
      { slug: 'what', name: 'What Althar is', note: 'Before anything else, in two minutes', q: 'What is Althar, and what isn’t it?' },
      { slug: 'install', name: 'Install and sign in', note: 'Your agents sign in with their own tools', q: 'How do I get it running?' },
      { slug: 'first-task', name: 'Your first task', note: 'Ask for something, and watch it go', q: 'What should I do first?' },
    ],
  },
  {
    id: 'pieces',
    name: 'The pieces',
    note: 'Five words, and what each one means',
    pages: [
      { slug: 'projects', name: 'Projects', note: 'Repositories, rules and history: the thing that lasts', q: 'What is a project?' },
      { slug: 'coordinator', name: 'The coordinator', note: 'Who you talk to. It plans, and never writes code', q: 'Who am I talking to?' },
      { slug: 'tasks', name: 'Tasks', note: 'One piece of work, in a worktree of its own', q: 'What happens to what I ask for?' },
      { slug: 'leads', name: 'Leads and steps', note: 'Who owns the work, and who checks it', q: 'Who is doing the work?' },
      { slug: 'reviews', name: 'Reviews', note: 'Another lab reads every change', q: 'Who checks the work?', implicit: true },
    ],
  },
  {
    id: 'behaves',
    name: 'How it behaves',
    note: 'What Althar does while you aren’t looking',
    pages: [
      {
        slug: 'needs-you',
        name: 'When something needs you',
        note: 'The only times it interrupts',
        q: 'When will it interrupt me?',
        implicit: true,
      },
      {
        slug: HERE,
        name: 'When an account runs out',
        note: 'The work moves on, or waits, or asks',
        q: 'My plan ran out. What now?',
        implicit: true,
      },
      {
        slug: 'permissions',
        name: 'Permissions and rules',
        note: 'What agents may do without asking',
        q: 'What can the agents do on their own?',
        implicit: true,
      },
      {
        slug: 'pull-requests',
        name: 'Pull requests and merging',
        note: 'Nothing is pushed until you say',
        q: 'When does anything reach GitHub?',
        implicit: true,
      },
      {
        slug: 'away',
        name: 'While you’re away',
        note: 'Quiet turns, retries, and the island',
        q: 'What happens when I walk away?',
        implicit: true,
      },
    ],
  },
  {
    id: 'lookup',
    name: 'Look it up',
    note: 'For when you know what you’re after',
    pages: [
      { slug: 'settings', name: 'Settings', note: 'Every setting, one by one', q: 'Where do I change that?' },
      { slug: 'shortcuts', name: 'Shortcuts', note: 'The keys worth learning', q: 'Is there a key for that?' },
      { slug: 'words', name: 'Words Althar uses', note: 'Every word on screen, and what it means', q: 'What does that word mean?' },
    ],
  },
]

export const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g })))

const at = PAGES.findIndex((p) => p.slug === HERE)
export const PREV = PAGES[at - 1]
export const NEXT = PAGES[at + 1]
export const GROUP_HERE = PAGES[at]?.group ?? GROUPS[0]
