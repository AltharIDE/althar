import type { Direction } from './state'

/* What each direction is for, and what it would take to build: the note the lab's bar opens (N). */

export const NOTES: Readonly<Record<Direction, { readonly for: string; readonly build: string; readonly size: string }>> = {
  a: {
    for: 'Working on a design with the lead that draws it. The artifact sits where canvases sit today, beside the task’s conversation, as a canvas of boards with no bar over it: what it is floats top left (its name opens every artifact on the project), its version, Share and where it lives float top right, and a tool bar sits along the bottom. Every board side by side or one at a time. Boards are whatever sizes the agent built; Althar has no size picker. Point at a part and say what you think: it goes in the conversation, and the board changes in place.',
    build:
      'A canvas made of pages and boards, each board an HTML file or an address in the task’s running copy, at the size the agent gave it. CanvasHost draws the boards as frames on a ground that pans and zooms, reusing the page view’s pointing. What you say about a part goes to the lead as a comment with the part’s selector. Share needs a link that opens in a teammate’s Althar, or as a public page.',
    size: 'Medium. Most of it is the canvas itself; publishing, versions and comments exist (ADR-104).',
  },
  b: {
    for: 'Finding artifacts across tasks, for whoever isn’t in the task. The Artifacts room shows them as cards, each a little of its canvas (its first boards side by side, live), or as a list. Find by words, filter by kind, where it lives, who made it and open comments, and sort by newest, name, boards or comments, grouped by task or not. Opening one gives it the room, with the conversation with its lead docked beside it, and the same floating head as beside a conversation.',
    build:
      'A’s canvas, plus a gallery over the project’s canvases. With many artifacts, the cards’ boards become stills drawn when a version is published, not live frames. The docked conversation is the task’s own thread in a narrow column, so the runtime doesn’t change.',
    size: 'Small, on top of A.',
  },
  c: {
    for: 'What an artifact looks like once a lot of work is in it: every page at once, a row each with its name over it, like a wall. Zoom out for the whole of it, open a page by its name, or go one board at a time through all of them. It’s Every page in the pages menu, beside a conversation or in its room.',
    build: 'A’s canvas laying out several pages as rows. With many boards at once, far ones are stills and only near ones are live frames.',
    size: 'Small, once A’s canvas exists.',
  },
  d: {
    for: 'Design review with people and the agent in one place. What you say about a part stays pinned on it, with the lead’s answer and the version it made, like comments that act. Teammates’ comments are pins the lead can take on, and the task’s conversation gets one line per change. Shared, the same board opens as a page where anyone comments without Althar, with a small Made with Althar mark in its corner that opens into a line and a link.',
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
  'Where it’s going: A, B and D together. The canvas beside the conversation (A) is where a design is made; the room (B) is where every artifact is found and reviewed; pins (D) are how people and the lead talk about a part. Every page at once (C) is how an artifact looks once a lot of work is in it, and saving to a repo goes in all of them.'
