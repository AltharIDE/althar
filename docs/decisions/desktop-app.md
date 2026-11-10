# The desktop app

This covers what the window does and why: how it reads, the first launch, how
a thread reads, what opens beside a conversation, dictation, themes, the
window's frame and motion. The look itself (colours, spacing, copy, motion's
feel) is in [DESIGN.md](../../DESIGN.md) and
[packages/ui/ARCHITECTURE.md](../../packages/ui/ARCHITECTURE.md). How the
window, the main process and the runtime fit together is in
[02, the desktop runtime](../architecture/02-desktop-runtime.md).

**Replaces:** ADR-014,
ADR-017,
ADR-025,
ADR-042,
ADR-053,
ADR-054,
ADR-055,
ADR-064,
ADR-069,
ADR-083,
ADR-098,
ADR-099,
ADR-100

## How the window reads

The window keeps what it has read in one cache for its life (TanStack Query,
in `renderer/data/`), by key: the projects, the agents, Home, a board, a
thread, a project's coordinator, rules and connections. View models read from
it, so a screen shows what was read before at once. The runtime is a local
process with its store on the same disk, so reads are fast; the flicker people
saw came from screens starting empty, not from slow reads.

- **Reads go out of date by change, never by age.** The window watches the
  runtime's change feed once, for every screen. A change reads again every
  whole read it touches, on screen or not, so the next place the person goes
  is already right. A change to a thread only marks it out of date; the
  screen showing it reads what changed, item by item, and a thread not on
  screen is read when it next opens.
- **A screen reads before it shows.** Each route's loader waits for its
  reads, and the screen being left stays until then, so a screen opens whole.
- **A slow read shows the place's outline,** and only past 150 ms, kept at
  least 300 ms so it doesn't flash (`router.tsx`). A screen never shows a
  spinner, and never draws what it hasn't read as empty.
- **The window opens behind its launch,** having read the place it opens on
  and every open tab.
- **Reads stay cheap.** What Home, a board and a thread read from git is kept
  per worktree, and read again only when the worktree moves.

The cache is never patched, only read again or marked. A full replica of the
store in the window, as Linear keeps, isn't worth a second copy of the domain
while the runtime is on the same machine.
[ADR-103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md)
would change that premise.

## A new project

A new project opens in a tab of its own, beside the projects' tabs: from the
tabs' +, Home's projects, ⌘N (Ctrl+N off the Mac), or folders dropped on
Home. People think of a project as a body of work first and its folders
second, so it is named first. Its folders come after, from the system's
picker (several at once), dropped, or one press from the repositories found
where people keep code. Each is read as it is added, and what reading found
(the code host, whether it is connected) is said before anything is made.

- **The window makes the project's id** (`proj_` and a UUIDv7) as the tab
  opens, and draws the project's mark from it while it is named, so the mark
  the person sees is the one the project keeps. The runtime checks the id's
  shape and that no project has had it, in the same transaction that makes
  the project. The project's ink is picked by the same shared function
  (`inkFor`) on both sides.
- **A project made on purpose is new,** even where its first folder is
  already another project's. A repository may be in several projects.
- **The draft is the window's, for this launch,** never stored. Closing the
  tab or Escape makes nothing; once made, the tab becomes the project's.

## The welcome

A fresh install opens on the Welcome: one card of steps, the same size from
step to step, with a track of its steps along its head (`features/start`).

- **A tour of four pages comes first,** each a scene of the real components
  at their real size where the window allows: work happens in projects; meet
  the coordinator; agents from different makers (a mark for every agent
  Althar runs, from the runtime's list); and the review a change gets, with
  the seal its pull request carries. Skip leaves it from any page. Once seen
  on this computer (`althar.toured`), it is left out of later first screens.
- **Then setup, one thing a step:** the agents on this computer, each signed
  in from its own row, with the others as tiles to download; the first
  project, a folder first, then the repositories found, with a field that
  finds one by name or place; the code host; and a tracker. The code host and
  the tracker can wait, and where no tracker can be connected there is no
  issues step. Only the project is needed: it can be made with no agent
  ready.
- **The project is made on its step,** and the welcome stays over it until
  its last step, so the code host's walk can name the project's own
  repository. The tabs stay hidden meanwhile. Left once the project is made,
  the welcome is over, and the next launch opens on Home.
- **A new project's empty conversation asks for what its tasks will need**
  (`FirstConnectionsView`): the code host its repositories' remotes name, or
  every host where they name none, and the trackers behind one menu. It goes
  once the conversation begins, once both are connected, or on Not now, kept
  for the project (`althar.firstConnections`).

Its scenes are demo data, not the person's own.

## A thread reads in rounds

A task's thread reads as what was asked, what the lead did, and its handoff.
The runtime pages it the same way, so a task opens on whole rounds.

- **A round starts with an ask:** what the person says, what the coordinator
  passes on, a review's findings, or Althar asking the lead to settle a
  conflict or fix its checks. What the coordinator passed on is written into
  the thread when the lead receives it, at the start of the turn it is
  delivered in, and drawn on the person's side under "From the coordinator".
  What the person says while a turn runs moves to where the lead read it.
- **The lead's work folds under one line,** and what it says last stands open
  under it, with its report: every screenshot it handed in, large, with its
  whole caption, grouped by their names; a view it showed before and took
  again named in a line, not shown twice; then what it checked and what it
  couldn't. No step cards, and no card closes the thread. A picture the
  lead's own tool read to check its work stays small inside the work.
- **Althar's notes.** Housekeeping (a branch made, a loop stopped) stays
  inside the work's line. What the person should know (a conflict, failed
  checks, a pull request opened) is one line in Althar's name.
- **A page starts at a round.** A page of the thread reaches back to the ask
  of the round its first item is in.
- **Leads are asked for it.** Their instructions say to acknowledge an ask
  briefly, say little while working, end with what they did, what to look at
  and what is left, show each screenshot once, and never list screenshots in
  a table. Nothing makes them; the thread reads best when they do.

The coordinator's own thread reads in turns, with the same work line.

### A turn at work

A turn at work, in a task's thread or the coordinator's, is one header, the
agent's words, and one live line (`WorkedFor`).

- Before anything, "Thinking" where the reply will go. Once it works,
  "Working for 8s", counting, then what the agent has said on the way, in
  order, in the thread's own voice, then one quiet line for what it is doing
  now: the tool it runs ("Reading MEMORY.md"), replaced in place, or what it
  is thinking about.
- **Thinking shows only in the trail.** Opened, each thought is a line
  ("Thought for 14s · what about") that opens to its words. What a thought is
  about comes from the thought itself (Codex's latest heading, or the first
  sentence of Claude Code's and OpenCode's thinking), not a model call.
- **Once it answers, it folds** under "Worked for 19s ›", and what it said
  last stands under it, where it was written, so it never draws again. A
  lead's round folds once the lead writes after its report. For the
  coordinator, Codex says which message is its answer, and Althar keeps that
  on the message. Claude Code and OpenCode don't, so a message after the work
  that is longer than 280 characters, or holds a list, heading, table or
  code, is taken for the answer; a short one folds as the turn ends.
- **The line says where its time went** (a task is a conversation plus
  parts, "Where a turn's time goes"): the total, from what the runtime kept
  of each turn (waiting for a place, starting or handing over its session,
  the agent's own work and its tools), and the part that took most where it
  wasn't the agent's own work and took a quarter of it or more: "Worked for
  4m · 3m 10s waiting for a place". Opened, every part comes first in the
  trail. A task adds its turns up under its Usage in Outputs.
- **What needs the person never folds:** a stuck step, a question, a
  permission, an error and its way out.
- **What stands open carries the whole turn.** A lead's last message (or its
  report, where nothing follows it) and the coordinator's answer hold
  everything the person needs from the turn in full: the proposal, every
  question, the findings, the decisions needed, what was built or not. They
  never point back at what folded ("see above"). Each role's brief says so,
  and a lead whose last message, shorter than what folded before it, only
  points back is told once to say it again (`runtime/src/lastMessage.ts`).

The person wanted something to watch while an agent works, without the
thinking spilling into the thread. Codex's app was the reference.

### Streamed text

Streamed text is shown on the screen's frames at the pace it has been
arriving, a whole word at a time, and catches up when it falls behind
(`packages/ui/src/lib/pace.ts`). Each new stretch comes in dim and brightens
over 700 ms, so text flows rather than pops (`Markdown/fresh.tsx`).
Half-written Markdown is held back where it would change its mind, and only
the block being written is read again (`Markdown/streaming.ts`,
`Markdown/lexed.ts`). With reduced motion it shows as it arrives, without the
fade.

### A review is a line

In a task's thread each review is one quiet line: who reviewed, what it found
and what became of it ("Review · 3 findings · 2 fixed, 1 declined"). It opens
to its findings. The lead's round settling it folds into that line once a
later round hands the work over again. The lead's latest handoff always
stands open, because it is what the person needs on opening a task. A review
under way is a turning line at the thread's end. Reviews themselves are in
[reviews.md](reviews.md).

## Code beside the conversation

Agents name code all the time. A name in what an agent wrote that reads as
code (a path with its lines, a file's name, a name in code) is a chip
(`CodeRef`), once the runtime says it is code (`FindCode`). Pointing at it
peeks at the lines; pressing it opens the whole file beside the conversation;
⌘-pressing it (Ctrl off the Mac) opens it in the person's editor.

- **It is read where the agent works.** A lead's names are read in its task's
  worktrees as they are, uncommitted work included. The coordinator's are read
  on each repository's default branch as this device last fetched it, with
  its lines followed through `git diff` from the commit the branch was at
  when it spoke, so they still point at what it meant. A name in code opens
  the one file that declares it; several give a choice. Only text is shown;
  nothing is kept.
- **Althar never edits.** The person ruled out Althar becoming an editor: no
  file tree, no tabs of files, no editing. The editor is one press away
  (Settings picks which).
- **Files are coloured by Shiki,** its grammars loaded as a language first
  shows, in the kit's syntax inks, which code blocks in messages share.

### The workbench

The right side of a conversation is the workbench (`Workbench`): one column
for what opens beside the thread (a lead's document, a file, a web page), one
at a time, beside it and never over it, as wide as the person drags it, its
width kept per kind. It leaves the conversation at least 420 px, or 440 px
beside a web page. What opens from inside it goes on top, with Back. Beside
the board, where there is no room to share, it opens over the board.

## A web page beside the conversation

A task's run always opens beside its conversation, on the workbench: from its
card in the thread, the Running pill, Run's list, and `p`, which also takes it
away. Links in a thread open there too, unless Settings › Browser keeps them
in the person's browser; a link pressed with a modifier opens a new tab. From
the coordinator's thread, a project's run opens beside the coordinator's
conversation, and the board steps aside. A page starts at half the window.
The person looks at a page *with* the lead, so it belongs beside the lead's
words, not in place of them.

- **Each task and project keeps its own page** while the window is open. A
  document or file takes the workbench and the page waits behind it. Open as
  a tab docks the page into a tab of its own, with its view, history and
  session; Back beside the task returns it.
- **The bar:** back, forward, reload, the address (with a shield that opens
  the page's session facts), Viewport, Comment, Open in your browser, Open as
  a tab, Close. One quiet line under it says when something was refused,
  sent out or asked for, with the one action that helps.

### What a page may do

The page is a `WebContentsView` the main process owns, laid over the window
where the window measures. It runs in its owner's own persistent partition:
`persist:task-<id>`, or `persist:project-<id>` beside the coordinator.

- **It can't reach Althar.** It has no preload, sandbox and context isolation
  are on, and Node and the `webview` tag are off. It can't reach Althar's
  bridge, the runtime's port, or anything Althar keeps. Every IPC call about
  pages checks that it comes from Althar's own windows.
- **Only `http:` and `https:` load.** `file:`, `javascript:`, a top-level
  `data:` or `blob:`, `about:` and other apps' schemes are refused, and the
  page stays where it was. Pop-ups open in the same view. Downloads are
  refused, with an offer to download in the person's browser.
- **Sign-ins stay in the person's browser.** A move to Claude's, GitHub's,
  GitLab's or Linear's sign-in, sign-up or app-granting pages goes to the
  person's browser instead, where they are signed in already. Other sign-ins
  (a company's SSO, a dev app's login) happen in the page's own session.
- **Every web permission is refused** (camera, microphone, location,
  notifications, reading the clipboard, devices, the screen, full screen,
  pointer lock), except writing to the clipboard what the person copies. A
  refusal the person would notice is said, with Open in your browser.
- **Cookies are kept as Settings › Browser says.** By default they last until
  the task is done; the other choices are until the page closes, until Althar
  quits, or as long as each site asks. When the runtime says a task is done
  or abandoned, or a project is removed, the page closes and its session is
  cleared; at start, the folders of sessions for work that is over are
  removed.
- **Viewport:** the panel's size, or Desktop, Laptop, Tablet or Phone, laid
  out at that size through the DevTools protocol, with touch and a phone's
  user agent for the last two. The session's user agent is Chrome's own,
  since some sites refuse Electron's.
- Three hidden pages are kept alive; past that the oldest sleeps, and loads
  again where it was. Pages outlive a window that closes or reloads, which
  asks the main process which it still has.
- While one of the window's menus, popovers or dialogs is over a page, the
  window shows a picture of the page in its place, since the native view
  would otherwise draw over them.

### Point and comment

Comment (⌘⇧C, Ctrl+Shift+C) points at the page. The main process injects an
overlay into an isolated world of the page, never the page's own, drawn in a
closed shadow root that takes the pointer, so the page sees no hover or
press. It outlines the element under the pointer; ↑ and ↓ widen and narrow
it, Enter takes it. Pressed, it describes the element (a selector unique to
it, its words, rect, font and colours, the page's size), and the main process
crops the spot. The comment is written in Althar's own window over a picture
of the page, so the page's scripts never see what the person types. It goes
into the composer as a chip beside the person's other attachments, and the
page keeps numbered pins.

Sent, the person's words go first, then each comment: its note, its element
and words, its size, its selector, the page and the size it was made at, and
which attached picture is its crop. The gathering
(`renderer/shared/comments.ts`, the kit's `CommentChip` and `CommentCard`) is
meant for every comment made beside a conversation.

**Not built yet:** comments on a line of the diff (DEV-175), which would use
the same gathering.

### Leads and the coordinator drive the page

The lead of a task, and the coordinator for its project, read and drive the
page beside their conversation: the very page the person looks at, in its
owner's own session. This overturns DEV-83's "agents driving this browser: not
now". They do it **without asking**, even though the page's session may be
signed in to things (a dev app, a company SSO): the notes allow everything by
default, and only what can't be undone asks. A lead's own `screenshot` tool
stays, for a page nobody has open: it draws a URL headless in a fresh session.

- **The tools** are one more part of the shared pool (ADR-097), served to both
  roles: `page_state`, `page_open`, `page_move`, `page_viewport`,
  `page_snapshot`, `page_screenshot`, `page_logs`, `page_click`, `page_hover`,
  `page_type`, `page_press`, `page_scroll`, `page_select`, `page_wait`,
  `page_evaluate` and `page_dialog`. A review's lead and a reviewer don't have
  them.
- **Whose page** is never an argument. The runtime reads it from the session:
  a lead reaches its task's page (`persist:task-<id>`), the coordinator its
  project's (`persist:project-<id>`), and nothing else.
- **The path** is the runtime's tool, then the host's `page` option, then the
  utility process's own channel to the main process, then `pages.ts`. The main
  process answers only the runtime it started, checks every call as it checks
  anything crossing a process, and drives only through `pages.ts`'s own
  functions, as the window does. The window has no channel for it and a page
  has no preload, so nothing but Althar's own processes can reach it.
- **Read.** `page_state` says what is open (address, title, viewport or
  device, whether it is shown beside the conversation, in a tab, waiting out of
  sight, or asleep). `page_snapshot` is the page's accessibility tree with a
  reference on each element (`e12`), built by the overlay's driver in the
  page's isolated world; a reference holds while its element stays on the page,
  and only in the document it was read from: once the page loads again (a dev
  server's reload, a navigation, a page that slept and woke), its old
  references are refused, with words to take a new snapshot.
  `page_screenshot` is the page at its current viewport as it is drawn, the
  same pixels the person sees, its whole length, or one element. `page_logs`
  gives console messages and failed requests since a mark.
- **Drive.** Navigate, back, forward, reload; click, type, press keys, hover,
  scroll and select, by a reference or a selector; wait for words or an
  element; set the viewport to the bar's devices; evaluate script in an
  isolated world of the page (its DOM, none of its scripts' variables), apart
  from the overlay's and never Althar's. Clicks, keys and text go in as real
  input through the debugger, so the page sees what it would from a person,
  and the lead never takes the keyboard from the window. Althar reading the
  page gives it no user gesture: only the lead's own input and script do.
- **Dialogs.** An alert or a confirm the page opens holds everything in it
  until it is answered. The debugger tells of it, so the action that opened it
  ends there and says what it asks, every later call says so at once rather
  than waiting on a page that answers nothing, and `page_dialog` answers it, OK
  or Cancel (Electron answers `prompt()` itself). Electron also shows it on the
  window, as a sheet on a Mac, which the person may answer instead; answered by
  the lead, the sheet goes. A page that asks to stay as the lead leaves it (its
  `beforeunload`, as for something unsaved) is left, and the lead hears it; as
  the person leaves it, it stays the page's to stop.
- **Open and wake.** `page_open` at an address opens a page beside the
  conversation where none is open, as Run's card would, and wakes one that
  went to sleep. The element words are the comment's (`describe`, the
  selector and label the overlay already produces).
- **Every guard holds.** Only `http:` and `https:` load; a sign-in to Claude,
  GitHub, GitLab or Linear goes to the person's browser; no permissions;
  downloads refused. What a guard refuses, the tool tells the lead in words,
  whether the lead asked for it or a click led there.
- **The person sees it, and wins.** While a lead acts, the element is outlined
  and a quiet line under the bar says who is at work there. A click, key or
  scroll the person makes in the page stops the lead's action in flight: the
  page counts the presses, keys and wheel turns it has from real input, and
  the lead's own are known, so any more is the person, in the page and in its
  frames of the same origin (Storybook's preview), a frame that loads another
  document listened to again; a frame of another origin
  can't be listened to. What waited its turn behind the stopped action isn't
  done either. While the person points at the page to comment, the lead's
  actions wait for them, and its reads go on.
- **A call the runtime gave up on** (its agent stopped, or it waited two
  minutes) is said to the main process: what hasn't begun isn't done, and an
  action under way stops at its next step. Every call into the page is
  bounded, so no page holds a lead or the calls behind it.
- **Asleep.** A page an agent works on while no conversation shows it is the
  one hidden last, so the last of the hidden pages put to sleep, and one with
  a call under way isn't. Woken, its log goes on from the mark it had.
- **When it isn't there,** the tool says so: no window of Althar's open,
  Althar quitting, nothing open beside the conversation, a task that is done.
  A call that only asks what is open (`page_state`) still answers.

## The step graph

A task's steps are a face of their own, Graph (`g`), beside Conversation (`c`)
and Outputs (`o`), offered once the task has rounds of work. It shows what the
header's track and the thread can't: a review that found something and was
settled and reviewed again, who did each step, a step waiting, a follow-up
after merge.

- **The runtime says what a task went through** (`ThreadSnapshot.task.graph`):
  each run with its steps in the order they ran, where each step's last try
  stands, its agent and model, and when it started and ended. It is read from
  the store's runs, nodes and tries (`graph.ts`), never stored. Only the
  runtime knows who ran a step or what held it; reading the graph from the
  thread's words broke on every wording change. What is still to come is only
  what the plan has and hasn't started, never guessed.
- **The window adds what each step came to,** from its report, and puts the
  person's waiting calls on the step they hold up
  (`features/task/graph.ts`).
- **The kit's `StepGraph` draws it:** a lane for each agent and model, the
  lead's first and Althar's last; each step a card in the order the steps
  ran; straight lines between lanes; a marker where each round starts. A card
  opens its report, where a stuck step's call or waiting permissions can be
  answered. A marker takes the person to that place in the thread.

**Not built yet:** conflicts and fixing checks as steps. They aren't steps of
the run in the runtime, so they don't show on the graph.

## Files sent with a message

Any file or folder can go with a message, in a task's thread or the
coordinator's. Images go as images to an agent that takes them; anything
else goes as a file chip with its name and size. A message carries at most 10
files and folders, each at most 50 MB (a folder's files together, at most
2,000 of them), and 100 MB in all (`MESSAGE_FILES`).

- **The window never has the path.** The main process measures what is added
  and grants it to the runtime; the window gets the grant, name and size.
- **It is copied where the agent reads,** into
  `.althar/attachments/<message>/` in the folder its agent starts from: a
  task's worktree (or the folder holding several), or the coordinator's
  folder. A `.gitignore` there keeps the copies out of git. The person's file
  is usually in Downloads or on the Desktop, which an agent's sandbox may not
  reach; inside its own folder every agent reads it as it reads the task's
  files. What is copied is counted again as it is copied, and a file that has
  grown past the limits refuses the message.
- **Linked in every turn that delivers it,** as an ACP `resource_link`, which
  every agent can open. A text file of at most 100 KB goes as its words
  instead, to an agent that takes embedded context. No file goes as raw bytes.
- **Recorded with the message,** so the thread shows them after a restart and
  a new agent's brief says where they are. The copies go with the task's
  folder.

A message with files can't go to a task whose folder isn't on this computer
right now; the composer says so.

## Dictation

Dictation is local, always. Speech is turned into text on this machine and
never leaves it: what someone says about their code is as private as the
code. The only thing dictation fetches is its model.

- **The model comes down only when asked for.** The first press of the
  microphone opens a tray that says what dictation needs and how big it is;
  nothing downloads until Download is pressed. The microphone is asked for
  first.
- **One pinned model, checked:** Parakeet TDT 0.6B v3 int8 (about 670 MB),
  each file checked against a SHA-256 in the app (`src/speech/model.ts`). A
  download resumes after a dropped connection and checks there is room first.
  The model is kept in the profile, shared by every window and launch. It
  covers 25 European languages.
- **Its own process.** The main process starts a speech utility process when
  someone dictates or downloads, and stops it after ten minutes idle, so a
  native addon failing can't take agent sessions with it, and its memory
  (about a gigabyte) goes with it.
- **What was said lands at the cursor, never sent.** Escape while listening
  throws it away. Words show faintly about once a second as they are said;
  when the person stops, it is all written down once more, which reads
  better.
- **The project's own names are spelt as its code spells them.** The runtime
  reads the project's multi-part names from git (`GetVocabulary`), and "refund
  ledger dot ts" becomes `RefundLedger.ts` where that file exists. Biasing the
  model itself was tried, and broke the words around the names. The agent is
  told the message was dictated, so it reads past what was misheard.
- **⌘⇧D (Ctrl+Shift+D)** starts and stops it from anywhere in the window;
  held down, letting go stops it. Leaving the composer while it listens keeps
  it listening in a pill that says whose it is. Once written, it goes to the
  thread it was said in, or into the composer on screen.

Hosted transcription would be better on accents and noise, but speech would
leave the machine. Windows on Arm has no build yet.

## Light and dark

Settings › Appearance offers Light, Dark and Match the system, worded for each
system (Match the Mac, the PC, the computer). It starts at Light; only a
written Match the system follows the system. There is one dark, a warm one.

- **The main process sets Electron's `nativeTheme.themeSource`** from the
  preference. On a Mac and Windows the system's scheme is followed by
  Electron. On Linux the main process follows the desktop's Settings portal
  (`color-scheme`). Every page follows the resulting `prefers-color-scheme`:
  a script in each page's head sets `data-theme` before the first frame. The
  window never reads the preference to theme itself.
- **Dark is a full second set of tokens** (`packages/ui/src/styles/dark.css`).
  Components name roles, never a theme: no CSS module mentions `data-theme`,
  and `packages/ui/tests/tokens.test.ts` keeps it so, along with WCAG AA for
  the pairs that carry meaning. A project's mark keeps its own inks in every
  theme, as an app's icon does.
- **Nothing of the other scheme shows first.** The first window opens once
  the preferences are read, and every window's background is the page's
  shade in its scheme.
- **The tray follows the taskbar or the panel, not the app.**

## The window on each desktop

The window is dressed for the desktop it sits on, decided by Althar, not by a
setting: the person asked that it belong without having to pick. The main
process reads the desktop (`main/desktop.ts`, `main/desktopChrome.ts`) from
the environment, the Settings portal, D-Bus, KDE's config files and, on X11,
the window manager's name. The only programs it ever runs are `gdbus`,
`xprop` and `gsettings`, with a timeout and no shell. Desktop programs
(`plasmashell`, `kreadconfig6`) crash without a display or open dialogs, so a
test holds the list.

| Desktop | Frame | Althar's buttons |
| --- | --- | --- |
| macOS | inset title bar | none: the system's traffic lights |
| Windows | frameless | Windows' manner, the bar's full height |
| A tiling window manager | frameless | none |
| GNOME and its family (Ubuntu, Pop, Budgie, Pantheon…) | frameless | GNOME's, in its `button-layout` order and side |
| KDE Plasma | the window manager's | none |
| Other stacking window managers on X11, and Wayland compositors that frame windows | the window manager's | none |
| Anything else | frameless | GNOME's, plain, on the right |

- **The frame is decided as the first window opens,** since Electron fixes
  it then. Slow reads don't hold the launch: what they found last time is
  cached in the profile (`window-chrome.json`) for the same desktop, so on
  X11 the first launch may go by the environment alone and the second is
  right.
- **The buttons are Althar's own drawing** (`WindowButtons`), in each
  desktop's manner, never its artwork. Each is a real, named button reached
  by keyboard, its glyph always shown.
- **The accent is a setting** (Settings › Appearance › Accent colour,
  Althar's violet by default). Set to the system's, it takes the nearest
  shade that keeps WCAG contrast in each use and scheme; where none would,
  Althar keeps its own and says why.

**Not built yet:** Windows' own caption buttons (`titleBarOverlay`), left
until the build is checked on a real Windows machine.

## Motion

Motion is one system, named by what happens, in CSS and the browser's own
animations, with no library. The person picked the crafted direction, with
springs, across the whole app: motion with a purpose, fast, and never in the
way of what is done often. The tokens and their values are in
[DESIGN.md § Motion](../../DESIGN.md#motion).

- **What arrives or goes** uses `--enter` and `--exit` (exits quicker);
  **what moves** uses `--move`, a spring; a selection moving between choices
  uses `--slide`. The springs are sampled as CSS `linear()` curves
  (`lib/spring.ts`), with the same values in `lib/motion.ts` for script.
- **Overlays grow from what opened them,** and dialogs from their middle. The
  command menu, opened by key many times a day, is there at once.
- **Lists move as a whole** (`ListMotion`): an item keyed by `data-move`
  slides when its place changes, and a board card that changes lanes travels
  there as a copy above the board. The board, Home's calls, the tabs and the
  composer's attachments use it. A card stays in its lane while the pointer
  is in Up next or Running, and travels once it leaves. A drag owns what it
  drags.
- **What lands in a thread rises into its place** (`useArrivals`), but not as
  the thread opens, not many at once, and not streaming words.
- **Still, on purpose:** switching tabs, projects and rooms, opening Home or
  a task, anything done by key, and anything that repeats.
- **Reduced motion:** nothing travels, grows or slides; lists only fade.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 8 Nov 2026: what stands open after a turn folds carries everything the person needs, never "see above" (#699).
- 10 Nov 2026: a thread marks a new change as a stamped row of its own; the board keeps chats on Scratch behind one chip; the plan card's kicker names its preset; the header's parts move a task, point it elsewhere, run a review's code and stop a helper ([tasks](tasks.md#changing-parts)).
- 10 Nov 2026: Scratch is a shelf of its own, by each chat's latest exchange, with Clear; the board card says one sentence across a task's changes with a mark for each; Shipped, Merged and Helper rows in the thread, a helper's opening in place to its work, and helpers' lanes on the Graph face; the plan card's preset picks another; Settings edits presets ([tasks](tasks.md#chats-and-scratch)).
