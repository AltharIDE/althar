/*
 * The site's release notes as they stand on the 0.10.0 entry's branch
 * (althar/changelog-entry-for-0-10-0-led-by-your-own-host, #1097,
 * apps/site/src/content/changelog.ts), copied for the lab: every release, in
 * the releases' own words, and what's next. Only what the site needed to
 * know what's published is gone: here every release is out.
 */

export type Kind = 'new' | 'improved' | 'fixed'

export const KIND_WORD: Record<Kind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' }

/** The kinds, in the order the release notes give them. */
export const KINDS = Object.keys(KIND_WORD) as Kind[]

export interface Change {
  kind: Kind
  /** One line; `code` in backticks. */
  text: string
}

export interface Release {
  version: string
  /** ISO date it was published. */
  date: string
  /** What the release is about, in a few words. */
  title: string
  changes: readonly Change[]
}

/** The releases, newest first. */
export const RELEASES: readonly Release[] = [
  {
    version: '0.10.0',
    date: '2026-11-20',
    title: 'Althar on your own machines',
    changes: [
      {
        kind: 'new',
        text: 'Your own host: run Althar on a Linux server of yours, x64 or arm64, as a home for your projects. Their tasks and agents live there, and keep working when you close the window.',
      },
      {
        kind: 'new',
        text: 'Connect to a home over SSH, or pair with a one-time code over HTTPS. Setting one up over SSH, step by step, comes with the host’s first signed release and a version of Althar that trusts its key.',
      },
      {
        kind: 'new',
        text: 'Make projects on a home from its window: clone a repository, pick a folder the home found, or start empty. An empty home welcomes you with what it has and what it still needs.',
      },
      {
        kind: 'new',
        text: 'From a home’s window, start tasks, talk to their leads and read what they changed. Answer an agent’s asks there with a security key you hold; merging there comes later.',
      },
      {
        kind: 'new',
        text: 'Your own workers: enroll a Linux machine, and a task’s lead runs on it, signed in to its own agent. The home keeps the task, its asks and its tools, and takes the worker’s commits back.',
      },
      {
        kind: 'new',
        text: 'Choose a worker when you start, or Best available worker: the home picks by free memory, disk and CPU, and the card says where the lead, setup and review will run before you start.',
      },
      {
        kind: 'new',
        text: 'On a worker, the project’s setup runs first, and Run’s builds, tests and dev servers run there too. A dev server opens in a private window through the home, live reload and all.',
      },
      {
        kind: 'new',
        text: 'Where the worker’s agent supports it, a task sends up to eight repositories, and its helpers join it there. Codex and Claude leads keep their skills, and HTTP MCP servers connect through the home; a command-based one is registered on the worker. Save a local copy brings the work to your computer.',
      },
      {
        kind: 'new',
        text: 'Workers work for a home on your server, or for Althar on your Mac. Each connects straight to its home, or both dial out to a relay, and ending a project’s grant stops its work there.',
      },
      {
        kind: 'new',
        text: 'Settings › Computers: your home and each worker, what it runs and what it has free, with Add a worker and Remove. This Mac’s popover lists them too, and how many agents are at work.',
      },
      {
        kind: 'new',
        text: 'Workers run on Linux for now, and you enroll them from the home’s command line. A task runs on one when it has a worktree of its own and the worker has its lead’s agent; reviews run on the home.',
      },
      {
        kind: 'new',
        text: 'From a terminal: Althar’s command line starts or joins a task on a home over SSH and streams its agent as it works. Leave, and the work goes on.',
      },
      {
        kind: 'new',
        text: 'A managed home can take signed updates: give it a release key and a release feed, and each update is checked as it downloads and applied when you say.',
      },
      {
        kind: 'new',
        text: 'Computer use: a task’s lead uses the apps on your computer, with one ask a turn. Its card shows what it’s doing and its latest screenshot, with Take over and Stop, and what it saw can be kept as evidence.',
      },
      {
        kind: 'new',
        text: 'Artifacts you talk to: open one beside its own chat, point at a part and say what you think, and its agent draws a new version. Lay out boards side by side, every board or one at a time, save it to a repository, or download it.',
      },
      {
        kind: 'new',
        text: 'Goals: give a task’s lead a `/goal`, and it keeps working toward it turn after turn, reporting as it goes, until it’s met, blocked or you pause it. The goal follows the task when its lead changes.',
      },
      {
        kind: 'new',
        text: 'The thread shows what agents look up and hand off: web searches and pages read, sub-agents with what they did, and each compaction with its summary.',
      },
      {
        kind: 'new',
        text: 'Work on a contributor’s pull request from their fork, on GitHub or GitLab, where they allow maintainers’ edits.',
      },
      {
        kind: 'new',
        text: 'Leads hear the review bots a project trusts, such as CodeRabbit, Copilot or Claude’s review, as findings to weigh. Trust one from the thread or the project’s settings.',
      },
      {
        kind: 'new',
        text: 'Codex offers GPT-6.2 Sol. When a plan runs low, the work moves to the same model through another agent or account before a different model, and the task says which.',
      },
      {
        kind: 'new',
        text: 'More agents: connect any coding agent from the ACP registry, or your own by its command. Althar checks it can do the work before it gets any.',
      },
      {
        kind: 'new',
        text: 'Terminals in Althar: runs and terminals along the foot of the window, each opening in a drawer. Show or hide them from the Layout menu.',
      },
      {
        kind: 'new',
        text: 'Bring in work from Conductor, Orca, T3 Code, Paradev, Cursor and Codex: their worktrees become tasks where they are, with Claude Code’s and Codex’s conversations as their history.',
      },
      { kind: 'new', text: 'Leads run Xcode, the iOS Simulator, Android’s emulator and Gradle, to build and try a mobile app.' },
      { kind: 'new', text: 'Comment on lines of a task’s diff and send them to its lead, with the code they’re about.' },
      {
        kind: 'new',
        text: 'Dictate from anywhere: a shortcut listens on any screen, and you place the words in a task or the coordinator after.',
      },
      { kind: 'new', text: 'ClickUp as a tracker, beside Linear, Jira and Trello.' },
      {
        kind: 'new',
        text: 'A task can come from several issues: each moves as it starts, and closes or gets its comment as it merges.',
      },
      {
        kind: 'new',
        text: 'New projects three ways: start empty, from a folder, or clone. One only on your computer merges its tasks there, and goes on a code host when you like.',
      },
      { kind: 'new', text: 'Clone a repository into a project, from your code hosts or a pasted address.' },
      { kind: 'new', text: 'A task stopped at its usage limit carries on by itself once the limit resets.' },
      { kind: 'new', text: 'Tune the built-in presets: their lead, reviewer, effort and brief, with Reset.' },
      { kind: 'new', text: 'Plan usage shows when each window resets, and marks how far through it you are.' },
      { kind: 'new', text: 'A waiting task says what it waits for, on its card, its page and the plan.' },
      { kind: 'new', text: 'Ship says where it takes the change: a review first or not, then a push, ready or merged.' },
      { kind: 'new', text: 'About Althar shows where Althar keeps its data and how much, with Free up space beside it.' },
      { kind: 'new', text: 'Agents pick up `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL`, for a gateway of your own.' },
      { kind: 'improved', text: 'Althar answers at once, however busy your computer is: the model picker, search and the board included.' },
      { kind: 'improved', text: 'Switching a lead’s model shows the new one at once.' },
      {
        kind: 'improved',
        text: 'Althar stays light with nothing running: idle coordinators rest after half an hour and wake on your message, and Home opens fast in a long-used profile.',
      },
      { kind: 'improved', text: 'A full session compacts in place and carries on, rather than starting afresh.' },
      { kind: 'improved', text: 'Agents running at once share the computer’s CPU, so none starves the rest.' },
      { kind: 'improved', text: 'Long threads open and scroll smoothly, at any length.' },
      {
        kind: 'improved',
        text: 'Every coordinator session starts from the project’s record: its notes, open tasks, and the repositories’ `AGENTS.md` and `CLAUDE.md`.',
      },
      { kind: 'improved', text: 'Leads and the coordinator know your local date and time.' },
      { kind: 'improved', text: 'Up next starts work as soon as an agent is free.' },
      {
        kind: 'improved',
        text: 'A task’s shape changes in place, either way: a change stepped back into a prototype keeps its pull request, and carries on in it once it’s a change again.',
      },
      {
        kind: 'improved',
        text: 'Stopped work waits in Up next with Resume, out of Needs you unless it asks something. Choosing a task’s review, or none, lives in Change the team.',
      },
      {
        kind: 'improved',
        text: 'Markdown files draw their HTML as GitHub does: a README’s banner, tables of pictures, and alerts as callouts.',
      },
      {
        kind: 'improved',
        text: 'Running settings: long lists search, and Ask the coordinator puts your request in its composer, unsent.',
      },
      { kind: 'improved', text: 'An issue’s card says what merging does to it: Closes it, or Part of it.' },
      { kind: 'improved', text: 'Only the checks a code host requires hold a change back; an optional one that fails is a quiet note.' },
      { kind: 'improved', text: 'Running settings show each repository’s setup command, who set it, and let you change it.' },
      { kind: 'improved', text: 'GitLab reviews post their summary and line comments together.' },
      { kind: 'improved', text: 'Comments you haven’t sent stay in the composer across restarts.' },
      { kind: 'improved', text: 'Asides start in a project of several repositories.' },
      {
        kind: 'improved',
        text: 'The coordinator’s errands carry on once a task’s review settles, its checks pass or its lead finishes, even where that happened first, and a merge-then-tag errand tags only after the merge.',
      },
      { kind: 'improved', text: 'When git fails, its own error says why, and a worktree whose link broke is repaired.' },
      { kind: 'improved', text: 'The conversation bar lists recent conversations, with a search.' },
      { kind: 'improved', text: 'Merge shows the queue at once, and lands with a burst.' },
      { kind: 'improved', text: 'A run shows it started at once; a failed one offers Help me fix it.' },
      { kind: 'improved', text: 'The thread says when a lead is handed on at a usage limit.' },
      { kind: 'improved', text: 'A small change’s card lets you pick its team.' },
      { kind: 'improved', text: 'Claude Code’s adapter is 0.109.0 and Codex’s is 2.8.0.' },
      { kind: 'fixed', text: 'Dictation tries a failed transcription again before saying it failed.' },
      { kind: 'fixed', text: 'A lost agent connection ends the turn, rather than saying Following up.' },
      { kind: 'fixed', text: 'Gemini takes Althar’s tools.' },
      { kind: 'fixed', text: 'Screenshots reach a pull request on GitHub again.' },
      { kind: 'fixed', text: 'Ship shows for commits held before a task’s first pull request.' },
      { kind: 'fixed', text: 'Ship releases only this computer’s holds; work held on another stays held.' },
      { kind: 'fixed', text: 'A fork is recognised whatever its remotes are called.' },
      { kind: 'fixed', text: 'Run servers nothing owns any more stop.' },
      { kind: 'fixed', text: 'Board cards stay in their column while you move the divider.' },
      { kind: 'fixed', text: 'A message sent to an idle agent never flashes as queued.' },
      { kind: 'fixed', text: 'The chat holds still while nothing changes.' },
      { kind: 'fixed', text: 'Pictures over GitHub’s 10 MB limit still reach the pull request.' },
      { kind: 'fixed', text: 'A review of your own pull request posts on GitHub as a comment, its verdict labeled.' },
      { kind: 'fixed', text: 'GitHub Copilot’s enterprise sign-in goes to your enterprise’s host.' },
      { kind: 'fixed', text: 'Discarded and unplanned tasks no longer linger as held.' },
      { kind: 'fixed', text: 'Keep for later is offered for every kind of finished task again.' },
      {
        kind: 'fixed',
        text: 'A ready task’s card in the thread says where it stands as the board does: Checks running, Not ready to accept with the check that failed, or Merge conflict, rather than Needs you.',
      },
      { kind: 'fixed', text: 'Failing checks always reach the lead or you, never a card saying Fixing the checks while nobody was told.' },
      { kind: 'fixed', text: 'Runs a task kept stop when its worktree is cleaned up.' },
      { kind: 'fixed', text: 'Canvases step aside for dialogs, and an aside’s canvases and files open beside its thread.' },
      { kind: 'fixed', text: 'Closing the browser beside a task brings the board back.' },
      { kind: 'fixed', text: 'File paths shorten at a folder, never mid-name.' },
      { kind: 'fixed', text: 'Long sign-in errors stay inside the account panel.' },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-15',
    title: 'Take back a turn',
    changes: [
      {
        kind: 'new',
        text: 'Undo from here, in a task with its own worktree: a message and the replies after it leave, the files they changed go back, and the prompt returns to your draft.',
      },
      { kind: 'new', text: 'Markdown files open rendered, with what changed marked and the source a click away.' },
      { kind: 'new', text: 'Steer or queue: choose what a message sent while an agent works does.' },
      { kind: 'new', text: 'Choose how new work takes turns among an agent’s accounts, for each project.' },
      { kind: 'new', text: 'Merge without queue, where GitHub lets you bypass it.' },
      { kind: 'improved', text: 'GitHub Copilot runs inside Althar, on your Copilot sign-in, no longer through OpenCode.' },
      { kind: 'improved', text: 'A message sent mid-turn shows in the queue at once.' },
      { kind: 'improved', text: 'Leads read the coordinator’s conversation with you.' },
      { kind: 'improved', text: 'Model pickers show models and effort; usage stays in Plan usage.' },
      { kind: 'improved', text: 'One title bar on every Linux desktop that allows it.' },
      { kind: 'improved', text: 'Closing the window remembers whether you chose to keep work running.' },
      { kind: 'fixed', text: 'Moving to another account when one runs out keeps the model and effort you chose.' },
      { kind: 'fixed', text: 'Turning crash reports off stops the reports still waiting to be sent.' },
      { kind: 'fixed', text: 'Asides clear when you clear them, and stay where you moved them.' },
      { kind: 'fixed', text: 'Dropping or joining a change cleans up its folder, on Windows too.' },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-13',
    title: 'Your app, beside the conversation',
    changes: [
      { kind: 'new', text: 'A browser beside the conversation: a task’s app, and links in a thread, open beside it.' },
      { kind: 'new', text: 'Comment on the page: point at anything and write; it goes to the lead with a picture of the spot.' },
      {
        kind: 'new',
        text: 'Leads use the page: they click, type and take screenshots in the page you’re looking at, to check what they built.',
      },
      { kind: 'new', text: 'Canvases: leads draw pages, mockups, diagrams and charts; comment, and the next version answers.' },
      { kind: 'new', text: 'Artifacts: every canvas a project’s agents drew, in one view, with each version.' },
      {
        kind: 'new',
        text: 'Search everything: one box finds tasks, pull requests, issues, what was said, notes and files, and acts on them.',
      },
      { kind: 'new', text: 'Keep talking to a finished task. What its lead commits waits for Ship, which reviews it and pushes it.' },
      { kind: 'new', text: 'Tasks wait for checks to pass, a pull request to merge or a set time, then carry on by themselves.' },
      { kind: 'new', text: 'Helpers: a lead starts other agents that work in the background while you talk to it.' },
      { kind: 'new', text: 'Several changes in one task, each with its own pull request, side by side or stacked.' },
      { kind: 'new', text: 'Change a task’s team, review or changes at any time, by telling its lead.' },
      { kind: 'new', text: 'Small changes in one step on a quick model, reviewed after they merge.' },
      { kind: 'new', text: 'Asides: quick questions beside the coordinator’s conversation. One that changes code becomes a task.' },
      { kind: 'new', text: 'Out of usage: the step moves to the strongest model you have with usage left.' },
      { kind: 'new', text: 'GitHub Copilot: sign in, and its models run tasks through OpenCode.' },
      { kind: 'new', text: 'Leads start tasks, which show live in their thread.' },
      {
        kind: 'new',
        text: 'Leads and the coordinator reach more of every tracker and code host: whole discussions, attachments, issues in bulk.',
      },
      { kind: 'new', text: 'Find your way in a long chat: a mark per message beside it, with a preview on hover.' },
      { kind: 'new', text: 'Settings, rebuilt: add an MCP server or a skill once, and every agent gets it.' },
      { kind: 'new', text: 'Reorder Up next by dragging: the order you set is the order tasks get an agent.' },
      { kind: 'new', text: 'A task’s card fills in as the coordinator drafts it.' },
      { kind: 'new', text: 'Keep a task’s setup as a preset for next time.' },
      { kind: 'new', text: 'Changes across several repositories show as one track, merged in order.' },
      { kind: 'new', text: 'The coordinator’s merges in one card that updates as each lands.' },
      { kind: 'new', text: 'Tasks can work toward a branch other than the default one.' },
      { kind: 'new', text: 'What a pull request needs before it can merge, on its card.' },
      { kind: 'new', text: 'Automations run on any agent you’re signed in to, not only on a plan.' },
      { kind: 'new', text: 'Before and after screenshots, and GIF recordings, on pull requests.' },
      { kind: 'new', text: 'Review after merge brings back only major findings, or every finding, or none: your choice.' },
      { kind: 'new', text: 'Each turn says where its time went.' },
      { kind: 'new', text: 'A warning a few days before an agent’s sign-in ends.' },
      { kind: 'new', text: 'Dictation in Settings.' },
      { kind: 'new', text: 'Window controls that match your desktop on GNOME, KDE and Windows.' },
      { kind: 'improved', text: 'Agents ask only before what can’t be undone: merging, publishing, posting as you, deleting.' },
      { kind: 'improved', text: 'Althar stays responsive when your computer is busy.' },
      { kind: 'improved', text: 'A calmer app: errors say what fixes them, with the fix beside them.' },
      { kind: 'improved', text: 'Steadier tasks: stopped and interrupted work picks up where it was, across restarts.' },
      { kind: 'improved', text: 'Asides open at once.' },
      { kind: 'improved', text: 'Hold, start or change the team of any task from the board.' },
      { kind: 'improved', text: 'Cleaner threads: a turn’s work is one live line, then folds.' },
      { kind: 'improved', text: 'Threads load earlier turns as you scroll up.' },
      { kind: 'improved', text: 'Tools named in plain words everywhere.' },
      { kind: 'improved', text: 'The coordinator plans from presets.' },
      { kind: 'improved', text: 'Models named as you know them.' },
      { kind: 'improved', text: 'Your own Codex install runs Codex’s sessions.' },
      { kind: 'improved', text: 'Skills are yours: Althar ships none of its own, and yours reach every agent.' },
      { kind: 'improved', text: 'Light theme meets WCAG AA contrast.' },
      { kind: 'fixed', text: 'Messages sent during a turn arrive in the order you sent them.' },
      { kind: 'fixed', text: 'Any reply from you clears “Waiting on you”.' },
      { kind: 'fixed', text: 'A fresh usage reading clears a stale “Out of usage”.' },
      { kind: 'fixed', text: 'An agent’s models show in the picker once you’ve signed in.' },
      { kind: 'fixed', text: 'Helpers a restart interrupted carry on after it.' },
      { kind: 'fixed', text: 'Comments by a repository’s maintainers reach the lead.' },
      { kind: 'fixed', text: 'Skipped checks no longer count as running or failed.' },
      { kind: 'fixed', text: 'A task never starts on a model that isn’t available.' },
      { kind: 'fixed', text: 'Merging main into a task’s branch no longer starts a review round.' },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-04',
    title: 'Reviewed before you see it',
    changes: [
      { kind: 'new', text: 'Review findings in the Changes view, at the lines they’re about, with what the lead did about each.' },
      {
        kind: 'new',
        text: 'Review section and seal on pull requests: who reviewed them, in how many passes, and what changed after review.',
      },
      { kind: 'new', text: 'Screenshots on pull requests, in one comment kept up to date.' },
      {
        kind: 'new',
        text: 'Welcome and setup on first launch: a short tour, then your agents, a project, and your code host and tracker.',
      },
      { kind: 'new', text: 'Usage per task: how much of your plans, or how many dollars, its agents used.' },
      { kind: 'new', text: 'Tasks in your own checkout, instead of a worktree of their own.' },
      { kind: 'new', text: 'Mermaid diagrams in threads and documents.' },
      {
        kind: 'new',
        text: 'Coordinator merges, queues and releases: ask it to merge a pull request once it’s green, bring a branch up to date, or tag and publish a release, using the host’s merge queue where there is one.',
      },
      { kind: 'new', text: 'Coordinator stops, holds, restarts and settles tasks when you ask.' },
      { kind: 'new', text: 'Intel Mac build, beside the Apple silicon one.' },
      { kind: 'new', text: 'Quit confirmation: quitting while work runs says what it will stop.' },
      { kind: 'new', text: 'Task folder setup: learnt once, repeated for every task.' },
      { kind: 'new', text: 'New repository for a new project.' },
      { kind: 'improved', text: 'Conflicts and failed checks go to the lead automatically, now on by default.' },
      { kind: 'improved', text: 'Fewer cards in Needs you: only what needs a decision from you.' },
      { kind: 'improved', text: 'Stopped leads restart on a comment or review on their pull request.' },
      { kind: 'improved', text: 'Run menu that says where each run goes: the default branch, a task, or a pull request.' },
      { kind: 'improved', text: 'Fewer permission asks for safe git.' },
      { kind: 'improved', text: 'Syntax highlighting in diffs.' },
      { kind: 'improved', text: 'OpenCode Go in Plan usage.' },
      { kind: 'fixed', text: 'Restarting Althar twice no longer pauses the running step.' },
      { kind: 'fixed', text: 'A stopped task with a green pull request can still be merged.' },
      { kind: 'fixed', text: 'A conversation Claude Code lost starts afresh.' },
      { kind: 'fixed', text: 'Jira Cloud on its own domain works.' },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-30',
    title: 'The hours you aren’t watching',
    changes: [
      {
        kind: 'new',
        text: 'Automations: work that starts by itself on a schedule, like a nightly dependency check, a Monday look at open pull requests or a morning triage of new issues. Each run is an ordinary task you can open, on your plans, one at a time, while Althar is open.',
      },
      {
        kind: 'new',
        text: 'How much of your plans is left: a gauge in the window’s bar, and each agent’s windows and when they reset. New work starts on the account with the most room.',
      },
      { kind: 'new', text: 'Dark mode: a warm dark, made from Althar’s own paper. Light, dark, or follow your computer.' },
      { kind: 'new', text: 'Drop in any file or folder, not only images: a PDF, a log, a CSV, a zip, a whole folder.' },
      { kind: 'new', text: 'A task as a graph: each agent gets a lane, each step a card saying how long it took and what it came to.' },
      {
        kind: 'new',
        text: 'Open the code an agent talks about: a file, a line or a function in a thread becomes a chip that opens it beside the conversation.',
      },
      {
        kind: 'new',
        text: 'Leads and the coordinator can change issues on your trackers, not only draft new ones: move, close, assign, relabel. Each change is a card to apply or discard.',
      },
      { kind: 'new', text: 'Run any branch or pull request, in a copy of its own. Your checkout isn’t touched.' },
      { kind: 'new', text: 'Leads show you pictures whenever you ask: screenshots of what they built, in the thread.' },
      { kind: 'new', text: 'Merge through GitHub’s merge queue, with the task saying “In the merge queue” until it lands.' },
      { kind: 'new', text: 'Several Linear workspaces, each bound to its own projects.' },
      { kind: 'new', text: 'Send now on a queued message: it interrupts the agent and goes first.' },
      {
        kind: 'improved',
        text: 'Failing checks go back to the lead, even after you’ve looked: it fixes what its change broke, reruns what failed by chance, and tells you what’s broken on the default branch too.',
      },
      { kind: 'improved', text: 'A finished task stops what it started: its agents, the servers they left running and its runs.' },
      {
        kind: 'improved',
        text: 'Finished tasks’ folders are removed after a while, sooner when the disk is nearly full. The branch stays, and the folder comes back when the task needs it.',
      },
      { kind: 'improved', text: 'Reviews start from a plan you can change, with the model and effort to review with.' },
      { kind: 'improved', text: 'Every error has a way out: Sign in again, Compact, or Connect, right where it happened.' },
      { kind: 'improved', text: 'Things move where they come from: menus grow from what opened them, cards slide from lane to lane.' },
      {
        kind: 'improved',
        text: 'Switching project tabs is instant, busy threads open faster, and Althar is far lighter on memory over a long day.',
      },
      {
        kind: 'improved',
        text: 'Resolve conflicts automatically, dependably: Althar checks each task’s branch itself, every couple of minutes.',
      },
      {
        kind: 'improved',
        text: 'What can’t be undone always asks, even where a project allows everything; with everything allowed, a lead’s ordinary work no longer stops for a card.',
      },
      { kind: 'improved', text: 'Leads lose fewer turns to their sandbox: each project works out what runs outside it from the start.' },
      { kind: 'improved', text: 'Running means running: the board counts only the tasks an agent is working on right now.' },
      { kind: 'improved', text: 'Linux and Windows have their own words and keys.' },
      {
        kind: 'fixed',
        text: 'A dropped connection no longer leaves a step Stuck: it waits for the connection and carries on by itself.',
      },
      { kind: 'fixed', text: 'Folder sizes you can trust: what a folder shows is what removing it frees.' },
      { kind: 'fixed', text: 'A stopped task with a conflict shows as stopped, and Carry on picks it up again.' },
      { kind: 'fixed', text: 'The load meter counts all of Althar’s work, not as little as a fifth of it.' },
      { kind: 'fixed', text: 'A sign-in you cancel stops there.' },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-20',
    title: 'Windows, and seven more agents',
    changes: [
      {
        kind: 'new',
        text: 'Althar on Windows: an installer for x64 that installs for you alone, with no administrator’s prompt, and updates itself. It isn’t signed yet, so SmartScreen warns the first time: More info, then Run anyway.',
      },
      {
        kind: 'new',
        text: 'Seven more agents: GitHub Copilot, Junie, Grok Build, Kimi Code, Mistral Vibe, Qwen Code and Google Antigravity. Each one joins only where Althar can keep it asking before it acts.',
      },
      {
        kind: 'new',
        text: 'Attach a task to a pull request it didn’t open, by its link or number. The task then follows it as its own: reviews, comments, checks and conflicts reach it.',
      },
      {
        kind: 'new',
        text: 'A task’s lead can draft issues on your trackers. Each draft is a card in the task’s thread, to file, edit or throw away.',
      },
      { kind: 'new', text: 'Up next lists every task waiting for a free agent, with its place in line. Drag a row to change the order.' },
      { kind: 'new', text: 'Drag a project’s tab along the bar to reorder your open projects.' },
      {
        kind: 'new',
        text: 'A project’s settings are a page of the project, beside its board: General, Code and issues, Rules, Running and Notes.',
      },
      {
        kind: 'improved',
        text: 'A finished quick task, prototype or review waits in Needs you until you choose Done or Keep for later, instead of settling itself the moment you open it.',
      },
      {
        kind: 'improved',
        text: 'When an agent runs out of usage, the card and the thread say which agent, on which step, until when, and what Althar is doing about it.',
      },
      {
        kind: 'improved',
        text: 'A task’s Outputs page is two columns: what the task is on the left, the change on the right, with its checks, its review and the one action that fits.',
      },
      {
        kind: 'improved',
        text: 'When the board is too narrow for its four lanes, they fold to slim rails instead of running off the side.',
      },
      { kind: 'improved', text: 'When you dictate a message, the agent is told, so a misheard name is read generously.' },
      {
        kind: 'fixed',
        text: 'A redirect before a command, as in `> /dev/null git push --force`, no longer gets it past asking.',
      },
      {
        kind: 'fixed',
        text: 'After a long shutdown, a task whose lead was working carries on by itself, instead of going stuck seconds after the next launch.',
      },
      { kind: 'fixed', text: 'A failed check’s log on GitHub can be read again: the card shows it and the lead gets it.' },
      { kind: 'fixed', text: 'In a Linux Flatpak, sign-ins are kept across restarts.' },
      { kind: 'fixed', text: 'When a step’s agent can’t start, the step says why.' },
    ],
  },
  {
    version: '0.4.1',
    date: '2026-10-18',
    title: 'Crash reports, and pull requests written for a reviewer',
    changes: [
      {
        kind: 'new',
        text: 'Crash reports: when something in Althar fails, it can tell us without you writing in, with folders, names, email addresses and keys taken out, and never your prompts, messages or files. Turn them off on the first screen or in Settings.',
      },
      { kind: 'new', text: 'On Linux, Althar’s tray mark is light on dark panels, and has a menu.' },
      {
        kind: 'improved',
        text: 'A pull request Althar opens has a description its lead writes for a reviewer: why, what changed and how it was checked, in the repository’s template where it has one.',
      },
      { kind: 'fixed', text: 'An agent Althar couldn’t check no longer hides the others. It says so on its own row, with Check again.' },
      {
        kind: 'fixed',
        text: 'An agent that never answers stops after two minutes and says it couldn’t start, instead of waiting for ever.',
      },
      { kind: 'fixed', text: 'Enter no longer answers a permission card; only a click does.' },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-18',
    title: 'Tell us what broke, from anywhere',
    changes: [
      {
        kind: 'new',
        text: 'Report a problem, from the app’s menu, quick settings or a stuck step. It sends what you write, with a screenshot and Althar’s logs, with folders, names and keys taken out.',
      },
      { kind: 'new', text: 'Dictation keeps going when you leave its screen. A pill says who the message is for.' },
      { kind: 'new', text: 'Push and merge from a board card, without opening the task.' },
      { kind: 'new', text: 'Tasks waiting for a free agent are listed in Up next, in the order they will start.' },
      { kind: 'improved', text: 'Between sending and the first word, Thinking shows where the reply will start.' },
      { kind: 'improved', text: 'Stuck cards say in plain words what happened and which button to press.' },
      { kind: 'improved', text: 'The composer’s foot stays on one row, and nothing is cut off in a narrow window.' },
      {
        kind: 'fixed',
        text: 'Abandoning a task closes its pull request on GitHub, GitLab or Bitbucket, and its branch, instead of only saying so.',
      },
      { kind: 'fixed', text: 'The home and the board agree on what needs you.' },
      { kind: 'fixed', text: 'A local merge no longer fails on a submodule it doesn’t move.' },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-16',
    title: 'Run many things, allow everything',
    changes: [
      {
        kind: 'new',
        text: 'A project can run many things, not one. The Run button is split: a press runs the first, and its list starts or stops any of them.',
      },
      {
        kind: 'new',
        text: 'Allow everything with one switch, for a project in Rules or for a single task from its menu. Never still holds.',
      },
      { kind: 'new', text: 'The coordinator can find and list pull requests, and start a review of someone else’s.' },
      { kind: 'new', text: 'Find any task, in a project or across all of them, from the keyboard.' },
      { kind: 'new', text: 'A finished task can go back to work and ship again, as a further pull request.' },
      {
        kind: 'improved',
        text: 'A task’s thread reads in rounds: your ask, its lead’s first word, its work in one line you can open, and its result.',
      },
      { kind: 'improved', text: 'A ready change says what stands in the way of merging, and the next thing to do.' },
      { kind: 'improved', text: 'Failed checks are run again once and read in full before the lead is told.' },
      { kind: 'improved', text: 'What you’ve written in a composer, and dictation, is kept when you go to another screen.' },
      { kind: 'fixed', text: 'A failed command keeps what it printed.' },
      { kind: 'fixed', text: 'Ordinary edits to one file are no longer stopped as a loop.' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-13',
    title: 'Tasks that show their evidence',
    changes: [
      {
        kind: 'new',
        text: 'A finished task ends with what it built, the evidence its lead showed (screenshots, test runs and what they printed) and anything it couldn’t check. The reviewer reads the evidence too.',
      },
      { kind: 'new', text: 'Set how many agents run at once. Past that, tasks wait for a free place.' },
      { kind: 'new', text: 'Rename a task from its header or its menu.' },
      { kind: 'improved', text: 'On Linear and Jira, a task’s issue moves to In Progress when the task starts.' },
      {
        kind: 'improved',
        text: 'The coordinator hands over to a fresh session before its context fills, so a long-running project keeps its thread.',
      },
      {
        kind: 'improved',
        text: 'A task whose branch drifted from its pull request offers to bring the two together, instead of failing the push.',
      },
      { kind: 'fixed', text: 'Push sends every commit, and the count clears.' },
      { kind: 'fixed', text: 'A conflict round no longer fails while the lead is still working.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-12',
    title: 'The first build',
    changes: [
      {
        kind: 'new',
        text: 'Open a folder as a project and tell its coordinator what you want changed. It plans tasks, each with a lead that implements it and a review.',
      },
      { kind: 'new', text: 'Claude Code, Codex and OpenCode, with the accounts you already signed in with.' },
      { kind: 'new', text: 'The home shows what needs you across every project.' },
      { kind: 'new', text: 'Dictation runs on your computer, after a one-time download of the speech model.' },
      { kind: 'new', text: 'Althar updates itself, never while work runs.' },
    ],
  },
]

export type Stage = 'now' | 'next' | 'later'

export const STAGE_WORD: Record<Stage, string> = { now: 'Now', next: 'Next', later: 'Later' }

/** The stages, soonest first. */
export const STAGES = Object.keys(STAGE_WORD) as Stage[]

export interface Planned {
  stage: Stage
  title: string
  detail: string
}

/** What's next: a draft until it's agreed. */
export const ROADMAP: readonly Planned[] = [
  {
    stage: 'now',
    title: 'Windows signing',
    detail: 'A signed installer, so Windows stops warning you the first time you open Althar.',
  },
  {
    stage: 'now',
    title: 'Event-based automations',
    detail:
      'Automations that start when something happens, not only at a time of day: a pull request opened, an issue filed, a check failing on main.',
  },
  {
    stage: 'next',
    title: 'Mobile app',
    detail:
      'See what needs you and answer it from your phone: allow a command, read a finished change, merge it. The work keeps running on your computer.',
  },
  {
    stage: 'next',
    title: 'Integrated simulators',
    detail: 'Phone simulators beside the task. A lead runs the app it changed, tries the flow and brings back what it saw.',
  },
  {
    stage: 'later',
    title: 'Project knowledge store',
    detail:
      'What a project has learned, kept: its decisions, conventions and notes, each with where it came from. Every agent starts from it, whichever one you use next.',
  },
  {
    stage: 'later',
    title: 'Teams, in the cloud',
    detail: 'Shared projects and hosted agents, for a team working on the same code.',
  },
]
