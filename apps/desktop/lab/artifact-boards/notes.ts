import type { Direction, Picker } from './state'

/* What each direction is for, and what it would take to build: the note the lab's bar opens (N). */

export const NOTES: Readonly<Record<Direction, { readonly for: string; readonly build: string; readonly size: string }>> = {
  a: {
    for: 'Working on a design with the lead that draws it, in an artifact chat: a conversation whose part is the artifact, beside it as a canvas of boards. The chat’s top row is the artifact’s, not a task’s: its name (which opens every artifact on the project) and who sees it, Draft, Shared or Published, where a task has its step; then its versions, comments, where it lives in git, Share, the canvas on its own, and Build it in the menu. The canvas keeps only its own: pages and every board or one at a time, zoom, and the tool bar. Boards are whatever sizes the agent built. Point at a part and say what you think: it goes in the conversation, and the board changes in place.',
    build:
      'A canvas made of pages and boards, each board an HTML file or an address in the task’s running copy, at the size the agent gave it. CanvasHost draws the boards as frames on a ground that pans and zooms, reusing the page view’s pointing. What you say about a part goes to the lead as a comment with the part’s selector. An artifact chat is a task with the artifact as its part (the loose-container direction): TaskHeader draws the artifact’s row while it has no workspace, review or pull request, and a task’s again once Build it gives it them. Who sees it is a field on the canvas; Shared and Published need a link that opens in a teammate’s Althar, or as a public page.',
    size: 'Medium. Most of it is the canvas itself; publishing, versions and comments exist (ADR-104).',
  },
  b: {
    for: 'Finding artifacts across tasks, for whoever isn’t in the task. The Artifacts room shows them as cards, each a little of its canvas (its first boards side by side, live), or as a list. Find by words, filter by kind, where it lives, who made it and open comments, and sort by newest, name, boards or comments, grouped by task or not. Cards say who sees each, and Filter narrows by it. Opening one is its chat: the same top row as beside a conversation, its way back to every artifact, the conversation with its lead docked beside the canvas.',
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
  e: {
    for: 'Picking where an artifact goes in git, from Save to repo in its top row. Four pickers first, one a moment, each showing the new folder where it would land with its name typed in place, how it goes in and when it’s committed. Then the one place (5–7): the project’s place for artifacts is a setting, so Save to repo is that place and Save, with the tree for somewhere else; the first save sets it, and Settings › Code and issues changes it. The picker seen last is the one Save to repo opens in A–D. Saved, it opens where it is, to move it or stop saving.',
    build:
      'Every picker needs the repositories’ folders: read from git at the default branch’s head (git ls-tree, folders only), in a worker, kept with the project’s file index and refreshed when the branch moves, so it opens at once. The rest is the renderer’s: a menu path, a tree, or columns, over that index. Suggestions come from where the project keeps such things (where its saved artifacts are, a design folder, the code the task changes), worked out when Save to repo opens. The one place is a project setting beside its repositories (folder, how, every version), read by Save to repo; Althar’s pick for the first save is its first suggestion, and a pull request where the repository’s main is protected.',
    size: 'Small, any of them: the index is the only new part, and Althar has most of it for finding files.',
  },
}

/** What each of E's pickers is for. */
export const PICKER_NOTES: Readonly<Record<Picker, { readonly label: string; readonly for: string }>> = {
  path: {
    label: 'Path',
    for: 'The path as a row whose every part is a menu of the folders beside it, over a list of what’s in the folder it goes in, like a save dialog. Compact and plain; you go one level at a time, so a deep folder takes a few clicks.',
  },
  tree: {
    label: 'Tree',
    for: 'The repository as the file tree an editor has, which a design engineer knows already. The new folder sits in it with the files it adds, as a commit would; click a folder to put it there, or drag it, and find a folder by its words. The most to look at, and the clearest about what lands where.',
  },
  columns: {
    label: 'Columns',
    for: 'The folders in columns, as a Finder does, with what it adds at the end. Good for seeing a path at once; it needs a wide popover, and deep folders scroll sideways.',
  },
  suggested: {
    label: 'Suggested',
    for: 'Where Althar would put it and why, one click each: with kiln’s designs, beside the code it designs, or in the team’s designs. Somewhere else finds any folder by its words. Most saves are one click; the reasons say what each place means.',
  },
  place: {
    label: 'One place',
    for: 'Suggested, down to the one place the project keeps artifacts: a setting, so most saves are Save. Somewhere else opens the tree, and can make the folder picked the place from now on. How it goes in is the setting’s, a line under the place with Settings beside it, not a choice each time. The first save in a project (6) is Althar’s pick with its reason, and sets the place; the setting (7) is under Code and issues, beside the repositories.',
  },
}

/** Saving to a repo, or not: the same in every direction, in the artifact's head. */
export const GIT = {
  for: 'An artifact lives in Althar until someone saves it to a folder in a repository: the project’s own, or one the team keeps for designs. Then it’s in git with everything else: reviewed and merged with the task’s change, in a pull request of its own, or straight to main, and readable on the code host by people who never open Althar. Browsing marks what’s in git, and finds what people committed by hand. The throwaway ones never leave Althar.',
  build:
    'A design saves as files: canvas.json for its pages, boards and sizes, each board’s page, and a README with every board as a picture. On the task’s branch it’s a commit in the lead’s own worktree; another repository needs a worktree of its own, as the project’s other repositories have. Finding them means looking for canvas.json in the project’s repositories. Comments stay in Althar, kept against the commit they were made on.',
}

export const PICK =
  'Where it’s going: A, B and D together. The artifact chat (A) is where a design is made, its top row the artifact’s and who sees it; the room (B) is where every artifact is found and opened into its chat; pins (D) are how people and the lead talk about a part. Every page at once (C) is how an artifact looks once a lot of work is in it, and saving to a repo goes in all of them. Its picker: the one place (E5), the project’s setting, so most saves are Save, with the tree (E2) for somewhere else.'
