/*
 * What changed in Althar, release by release, from the release notes on
 * GitHub, and what's next, from the plans in docs/plans. Each line in the
 * releases' own words, except that the site shows no ⌘-only shortcuts and
 * no internal labels.
 */

import { PUBLISHED } from './published'

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
  /** ISO date it was published: once its publish time is recorded (published.ts), that time's day, UTC; before, the day it's planned for. */
  date: string
  /** What the release is about, in a few words. */
  title: string
  changes: readonly Change[]
}

const REPO = 'https://github.com/AltharIDE/althar'
export const releaseUrl = (version: string) => `${REPO}/releases/tag/v${version}`

/** The releases' notes as written, newest first; RELEASES dates each that is out by its publish time. */
const WRITTEN: readonly Release[] = [
  {
    version: '0.10.0',
    date: '2026-11-27',
    title: 'Althar on your own machines',
    changes: [
      {
        kind: 'new',
        text: 'Your own workers, in early access: add a Linux machine of yours as a worker, and your tasks’ agents run on it instead of your Mac. Their work comes back to your Mac as commits.',
      },
      {
        kind: 'new',
        text: 'Add one from Settings › Computers, over SSH or with a one-time code: Althar installs it, signs its agents in, and checks it’s ready for your projects. Settings › Computers then shows what each worker is running and what it has free, and Remove uninstalls it from its machine.',
      },
      {
        kind: 'new',
        text: 'Choose where each task runs: your Mac, a worker, or Any free worker, which picks the one with the most to spare. Move it later from its menu.',
      },
      {
        kind: 'new',
        text: 'A task on a worker runs its setup, builds, tests and dev servers there, and you open its dev server’s page in Althar, live reload and all.',
      },
      {
        kind: 'new',
        text: 'Its helper agents and MCP servers go with it, its skills too with Codex and Claude, and up to eight repositories where its agent supports it.',
      },
      {
        kind: 'new',
        text: 'For now, workers run on 64-bit Linux with systemd, a task needs a worktree of its own to run on one, and reviews run where the project lives.',
      },
      {
        kind: 'new',
        text: 'Your own host, experimental: run Althar on a Linux server of yours, so your projects and their agents keep working with your laptop closed, and your workers can work for it too. Expect rough edges.',
      },
      {
        kind: 'new',
        text: 'Connect a home installs Althar on your server over SSH, step by step, or connects with a one-time code; from Flathub, install the host yourself, then connect. It updates from Althar too.',
      },
      {
        kind: 'new',
        text: 'In a server’s window, sign its agents and code hosts in, and make projects there: clone repositories, copy this Mac’s over, or start empty.',
      },
      {
        kind: 'new',
        text: 'From a server’s window, start tasks, talk to their agents and read their changes. Answering an agent’s permission requests there takes a security key; merging there comes later.',
      },
      {
        kind: 'new',
        text: 'From a terminal: Althar’s command line starts or joins a task on your server over SSH and shows its agent at work. Leave, and it keeps going.',
      },
      {
        kind: 'new',
        text: 'Computer use: a task’s agent uses the apps on your Mac as you would, opening any app, clicking and typing, with one permission request a turn. Its card shows its latest screenshot, with Take over and Stop.',
      },
      {
        kind: 'new',
        text: 'Artifacts you talk to: open a design beside its own chat, point at a part and say what to change, and its agent draws a new version. Compare boards side by side, save it to a repository, or download it.',
      },
      {
        kind: 'new',
        text: 'Goals: type `/goal` and a task’s agent keeps working toward it, turn after turn, until it’s done, stuck, or you pause it.',
      },
      { kind: 'new', text: 'Slash commands in every composer: `/goal`, `/compact` and more.' },
      { kind: 'new', text: 'What’s new: Althar has a tab of its own, with what each version brings and what’s coming next.' },
      { kind: 'new', text: 'Sign in to GitHub, GitLab and Linear in your browser.' },
      {
        kind: 'new',
        text: 'The thread shows what agents look up and hand off: their web searches, the pages they read, their sub-agents, and a summary each time they compact.',
      },
      {
        kind: 'new',
        text: 'Work on a contributor’s pull request from their fork, on GitHub or GitLab, where they allow edits from maintainers.',
      },
      {
        kind: 'new',
        text: 'Review bots you trust, such as CodeRabbit, Copilot or Claude’s review, pass their findings to the task’s agent. Trust one from the thread or the project’s settings.',
      },
      { kind: 'new', text: 'GPT-6.2 Sol, through Codex.' },
      {
        kind: 'new',
        text: 'More agents: add any coding agent from the ACP registry, or your own by its command. Althar checks it works before giving it a task.',
      },
      {
        kind: 'new',
        text: 'Terminals in Althar: your runs and terminals sit along the bottom of the window, each opening in a drawer. Show or hide them from the Layout menu.',
      },
      {
        kind: 'new',
        text: 'Bring in work from Conductor, Orca, T3 Code, Paradev, Cursor and Codex: their worktrees become tasks, with Claude Code’s and Codex’s conversations as their history.',
      },
      { kind: 'new', text: 'Agents run Xcode, the iOS Simulator, the Android emulator and Gradle, to build and try mobile apps.' },
      { kind: 'new', text: 'Comment on lines of a task’s diff and send them to its agent.' },
      {
        kind: 'new',
        text: 'Dictate from anywhere: press a shortcut on any screen, speak, and put the words in a task or the coordinator after.',
      },
      { kind: 'new', text: 'ClickUp as an issue tracker, beside Linear, Jira and Trello.' },
      {
        kind: 'new',
        text: 'One task can cover several issues: each is updated as the task starts, and closed or commented on when it merges.',
      },
      {
        kind: 'new',
        text: 'New projects three ways: start empty, from a folder, or clone, from your code hosts or a pasted address, several repositories at once.',
      },
      { kind: 'new', text: 'A project only on your computer merges its tasks there, and goes on a code host when you like.' },
      { kind: 'new', text: 'A task stopped at its usage limit carries on by itself once the limit resets.' },
      { kind: 'new', text: 'Tune the built-in presets: their agent, reviewer, effort and brief, with Reset.' },
      { kind: 'new', text: 'About Althar shows how much space Althar takes, with Free up space.' },
      { kind: 'new', text: 'Agents read `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL`, to go through a gateway of your own.' },
      { kind: 'improved', text: 'Althar answers at once however busy your computer is, the model picker, search and the board included.' },
      { kind: 'improved', text: 'Switching an agent’s model shows the new one at once.' },
      { kind: 'improved', text: 'Plan usage shows when each limit resets, and how far through it you are.' },
      {
        kind: 'improved',
        text: 'When a plan runs low, Althar keeps the same model, through another account or agent, before it switches models, and the task says which.',
      },
      {
        kind: 'improved',
        text: 'Althar stays light when nothing’s running: an idle coordinator sleeps after half an hour and wakes when you message it, and Home opens fast in a long-used profile.',
      },
      { kind: 'improved', text: 'A full conversation is compacted while it’s idle and carries on, rather than starting over.' },
      { kind: 'improved', text: 'Agents running at once share the CPU, so none starves the rest.' },
      { kind: 'improved', text: 'Long threads open and scroll smoothly.' },
      {
        kind: 'improved',
        text: 'The coordinator starts each session knowing the project: its notes, its open tasks, and each repository’s `AGENTS.md` and `CLAUDE.md`.',
      },
      { kind: 'improved', text: 'Agents know your local date and time.' },
      { kind: 'improved', text: 'Up next starts work as soon as an agent is free.' },
      { kind: 'improved', text: 'A waiting task says what it’s waiting for, on its card, its page and its plan.' },
      { kind: 'improved', text: 'Up next says when your Mac’s memory or CPU is holding agents back.' },
      { kind: 'improved', text: 'Abandon a task from its row in Up next.' },
      { kind: 'improved', text: 'Stopped work waits in Up next with Resume, out of Needs you unless it asks something.' },
      { kind: 'improved', text: 'A stopped task’s card says who stopped it and why.' },
      { kind: 'improved', text: 'Sort the Running column by status.' },
      { kind: 'improved', text: 'Each account offers the models it can really use.' },
      { kind: 'improved', text: 'An agent that fails to start says why, and tries again by itself.' },
      { kind: 'improved', text: 'Turn a change back into a prototype and into a change again, keeping its pull request.' },
      {
        kind: 'improved',
        text: 'Choose a task’s reviewer, or none, in Change the team; a small change’s card lets you pick its team too.',
      },
      { kind: 'improved', text: 'Markdown files show their HTML as GitHub does: a README’s banner, tables of pictures, and alerts.' },
      {
        kind: 'improved',
        text: 'Running settings: long lists search, each repository’s setup command shows and can be changed, and Ask the coordinator drafts your request to it.',
      },
      { kind: 'improved', text: 'An issue’s card says whether merging closes it or is only part of it.' },
      { kind: 'improved', text: 'Only the checks your code host requires hold a change back; a failing optional one is a quiet note.' },
      { kind: 'improved', text: 'Ship says what it will do before it does: a review or not, then a push, ready or merged.' },
      { kind: 'improved', text: 'GitLab reviews post their summary and line comments together.' },
      { kind: 'improved', text: 'Comments you haven’t sent stay in the composer across restarts.' },
      { kind: 'improved', text: 'Asides work in projects of several repositories.' },
      {
        kind: 'improved',
        text: 'The coordinator’s follow-ups wait for the right moment: they carry on once a review settles, checks pass or an agent finishes, and a tag waits for its merge.',
      },
      { kind: 'improved', text: 'A follow-up the coordinator can’t watch is turned down, with why.' },
      { kind: 'improved', text: 'The coordinator’s merges and follow-ups sit in one line at the foot of its thread.' },
      { kind: 'improved', text: 'The thread says what happened in a short line, never the agent’s raw output.' },
      { kind: 'improved', text: 'A failed usage reading says so in a few words.' },
      { kind: 'improved', text: 'Screenshots on a pull request sit two to a row, each with its caption.' },
      {
        kind: 'improved',
        text: 'Anonymous usage data, if you leave it on, covers more of how work goes. The privacy page lists every event, and Settings turns it off.',
      },
      { kind: 'improved', text: 'When git fails, you see git’s own error, and a worktree whose link broke is repaired.' },
      { kind: 'improved', text: 'The conversation bar lists recent conversations, with a search.' },
      { kind: 'improved', text: 'Merging shows the queue at once, with a burst when it lands.' },
      { kind: 'improved', text: 'A run shows it started at once; a failed one offers Help me fix it.' },
      { kind: 'improved', text: 'The thread says when a task moves to another agent at a usage limit.' },
      { kind: 'improved', text: 'Claude Code’s adapter is 0.113.0, and Codex’s is 2.12.1.' },
      { kind: 'fixed', text: 'Dictation tries a failed transcription again before showing an error.' },
      { kind: 'fixed', text: 'A lost agent connection ends the turn, rather than showing Following up.' },
      { kind: 'fixed', text: 'Gemini can use Althar’s tools.' },
      { kind: 'fixed', text: 'Signing in to Codex no longer fails while your computer’s DNS is slow to answer.' },
      { kind: 'fixed', text: 'An aside’s permission request no longer moves the window.' },
      { kind: 'fixed', text: 'The coordinator finds a fork’s pull requests on the repository it came from.' },
      { kind: 'fixed', text: 'A fork is recognised whatever its remotes are called.' },
      { kind: 'fixed', text: 'Screenshots over GitHub’s 10 MB limit still reach the pull request.' },
      { kind: 'fixed', text: 'Ship shows for commits waiting before a task’s first pull request.' },
      { kind: 'fixed', text: 'Run servers nothing owns any more are stopped, and a task’s runs stop when its worktree is cleaned up.' },
      { kind: 'fixed', text: 'Board cards stay in their column while you drag the divider.' },
      { kind: 'fixed', text: 'A message sent to an idle agent no longer flashes as queued.' },
      { kind: 'fixed', text: 'The chat holds still while nothing changes.' },
      { kind: 'fixed', text: 'Reviewing your own pull request posts on GitHub as a comment, with its verdict.' },
      { kind: 'fixed', text: 'GitHub Copilot’s enterprise sign-in goes to your enterprise’s host.' },
      { kind: 'fixed', text: 'Discarded and unplanned tasks no longer linger as held.' },
      { kind: 'fixed', text: 'Keep for later is offered for every finished task again, work waiting to be accepted included.' },
      {
        kind: 'fixed',
        text: 'A ready task’s card in the thread says what the board says: Checks running, Not ready to accept with the check that failed, or Merge conflict, rather than Needs you.',
      },
      { kind: 'fixed', text: 'Failing checks always reach the agent or you; no card says Fixing the checks while nobody was told.' },
      { kind: 'fixed', text: 'Canvases step aside for dialogs, and an aside’s canvases and files open beside it.' },
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

/**
 * A release as every page tells it: once its publish time is recorded, dated
 * by that time's day (UTC), whatever day its notes were written for, so the
 * page's stamp, its Markdown, llms.txt and the structured data all say the
 * day it went out.
 */
export const asPublished = (release: Release, published: Readonly<Record<string, string>> = PUBLISHED): Release => {
  const at = published[release.version]
  return at === undefined ? release : { ...release, date: at.slice(0, 10) }
}

/** The releases, newest first. */
export const RELEASES: readonly Release[] = WRITTEN.map((release) => asPublished(release))

/** Whether a release is out: its publish time is recorded. The newest entry may be written before it goes out. */
export const isOut = (release: Release): boolean => release.version in PUBLISHED

/** The newest release that is out: what every page calls the current version. */
export const CURRENT: Release = RELEASES.find(isOut) ?? RELEASES[RELEASES.length - 1]!

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
    title: 'Mobile app',
    detail:
      'Pair your phone with your home and follow every task from it. What needs you reaches you as a notification, and you answer it there, while the work runs on your computer or your own server.',
  },
  {
    stage: 'next',
    title: 'Event-based automations',
    detail:
      'Automations that start when something happens, not only at a time of day: main going red, a check that keeps failing, a new security alert.',
  },
  {
    stage: 'next',
    title: 'Integrated simulators',
    detail: 'iOS simulators beside the task. A lead runs the app it changed, tries the flow and brings back what it saw.',
  },
  {
    stage: 'next',
    title: 'Project knowledge store',
    detail:
      'What a project has learned, kept: its decisions, conventions and notes, each with where it came from. Every agent starts from it, whichever one you use next.',
  },
  {
    stage: 'later',
    title: 'Windows signing',
    detail: 'A signed installer, so Windows stops warning you the first time you open Althar.',
  },
  {
    stage: 'later',
    title: 'Teams, in the cloud',
    detail: 'Shared projects, and work that runs on machines in the cloud, for a team on the same code.',
  },
]
