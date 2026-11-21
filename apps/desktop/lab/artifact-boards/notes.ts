import type { Direction } from './state'

/* What each direction is for, and what it would take to build: the note the lab's bar opens (N). */

export const NOTES: Readonly<Record<Direction, { readonly for: string; readonly build: string; readonly size: string }>> = {
  a: {
    for: 'Working on a design with the lead that draws it. The artifact sits where canvases sit today, beside the task’s conversation, but as a canvas of boards: every board side by side or one at a time, pages, sizes, zoom, a tool bar. Point at a part and say what you think: it goes in the conversation, and the board changes in place. The artifact’s name opens every artifact on the project, so you browse without leaving.',
    build:
      'A canvas made of pages and boards, each board an HTML file or an address in the task’s running copy, at a size. CanvasHost draws the boards as frames on a ground that pans and zooms, reusing the page view’s pointing. What you say about a part goes to the lead as a comment with the part’s selector. Share needs a link that opens in a teammate’s Althar, or as a public page.',
    size: 'Medium. Most of it is the canvas itself; publishing, versions and comments exist (ADR-104).',
  },
  b: {
    for: 'Finding and reviewing artifacts across tasks, for whoever isn’t in the task. The Artifacts room becomes a gallery of live pictures, by task or newest. Opening one gives it the whole room, with the conversation with its lead docked beside it, so you talk to the artifact without opening its task.',
    build:
      'A’s canvas, plus a gallery over the project’s canvases. With many artifacts, the pictures become stills drawn when a version is published, not live frames. The docked conversation is the task’s own thread in a narrow column, so the runtime doesn’t change.',
    size: 'Small, on top of A.',
  },
  c: {
    for: 'Seeing everything at once, for a crit or a review. Every artifact’s boards are on one canvas, grouped by artifact: zoom out for the whole project, zoom in to work. Pick boards from different artifacts to compare or share them as a set.',
    build:
      'A’s canvas with a row per artifact. With many boards at once, far ones are stills and only near ones are live frames. A shared link carries a set of boards from several artifacts.',
    size: 'The most work. Past a dozen artifacts it gets hard to read, and it does what B’s gallery does.',
  },
  d: {
    for: 'Design review with people and the agent in one place. What you say about a part stays pinned on it, with the lead’s answer and the version it made, like comments that act. Teammates’ comments are pins the lead can take on, and the task’s conversation gets one line per change. Shared, the same board opens as a page where anyone comments without Althar.',
    build:
      'Canvas comments exist, anchored to a version. They’d anchor to a board and a part, and the lead would answer in the pin: a turn per pin, its answer posted back to the pin rather than only to the thread. Guests need a public page whose comments come back to the project.',
    size: 'Medium to large: the runtime has to send a turn’s answer back to a pin.',
  },
}

/** Saving to a repo, or not: the same in every direction, in the artifact's head. */
export const GIT = {
  for: 'An artifact lives in Althar until someone saves it to a folder in a repository: the project’s own, or one the team keeps for designs. Then it’s in git with everything else: reviewed and merged with the task’s change, in a pull request of its own, or straight to main, and readable on the code host by people who never open Althar. Browsing marks what’s in git, and finds what people committed by hand. The throwaway ones never leave Althar.',
  build:
    'A design saves as files: canvas.json for its pages, boards and sizes, each board’s page, and a README with every board as a picture. On the task’s branch it’s a commit in the lead’s own worktree; another repository needs a worktree of its own, as the project’s other repositories have. Finding them means looking for canvas.json in the project’s repositories. Comments stay in Althar, kept against the commit they were made on.',
}

export const PICK =
  'My pick: A, with B’s gallery as the Artifacts room and D’s pins for comments. A keeps the design beside the conversation that makes it, which is where a design engineer works, and it’s how Claude’s design view works too. B’s gallery is cheap and fixes browsing across tasks. D’s pins give people and the lead one place to talk about a part, without moving the whole conversation onto the board. C is fun, but it’s B at a larger scale, and it costs the most. Saving to a repo goes in whichever is built: it’s small, and it puts artifacts in git, where the team already works.'
