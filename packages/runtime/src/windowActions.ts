/*
 * Every button the person has on a task in the window (the task menu, the
 * Change card, a stuck step's answers, the plan card, the composer: each of
 * the task model's actions, `TaskModel` in the desktop app), and the tool
 * that does the same for the coordinator and the leads (ADR-097, "Matching
 * the window"). What has none says why: it can't be undone, so it stays on
 * the person's own word, or it is the person's alone (answering what an
 * agent asks them, their own message, their checkout); or it is the window's
 * own, such as reading further back or dismissing an error; or it is a
 * lead's on its own task. The desktop app's test checks this list against
 * the task model, so a button added there without a line here fails; the
 * runtime's checks each tool named is one both roles have.
 */

export type WindowAction =
  /** The tool that does it, served to the coordinator and the leads. */
  | { readonly tool: string }
  /** A tool that does it on the person's own message in the turn only: what can't be undone (ADR-081). */
  | { readonly word: string }
  /** The person's alone, and why. */
  | { readonly person: string }
  /** A lead's on its own task, by this tool. */
  | { readonly own: string }
  /** The window's own, and what it does there. */
  | { readonly window: string }

export const WINDOW_ACTIONS = {
  // The thread and the composer.
  dismissConflict: { window: 'hides the note about a merge that conflicted' },
  loadEarlier: { window: 'reads further back in the thread (read_thread does with before)' },
  readFiles: { window: 'reads the changed files for the person to look at (read_task_diff)' },
  send: { tool: 'message_lead' },
  sendNow: { tool: 'message_lead' },
  takeBack: { person: 'takes back their own message before the lead reads it' },
  interrupt: { tool: 'stop_task' },
  compact: { tool: 'compact_lead' },
  tryAgain: { tool: 'try_again' },
  choose: { tool: 'change_lead' },
  handOver: { tool: 'change_lead' },
  // The task menu.
  stop: { tool: 'stop_task' },
  skipReview: { tool: 'skip_review' },
  resume: { tool: 'restart_task' },
  setResolveConflicts: { tool: 'resolve_conflicts' },
  resolveConflictsNow: { tool: 'resolve_conflicts' },
  setAllowEverything: {
    person: 'loosens what asks on the task: an agent never frees itself from an ask (change_settings for the project’s)',
  },
  abandon: { tool: 'settle_task' },
  reopen: { tool: 'restart_task' },
  markDone: { tool: 'settle_task' },
  keep: { tool: 'settle_task' },
  rename: { tool: 'rename_task' },
  attach: { tool: 'attach_pull_request' },
  moveToFront: { tool: 'move_to_front' },
  // The plan card.
  startPlan: { tool: 'restart_task' },
  // Calls that wait on the person.
  answer: { person: 'answers an agent’s permission request: an agent never answers one itself' },
  answerStuck: { tool: 'answer_stuck_step' },
  answerCheckout: { person: 'lets a Local task take their own checkout' },
  move: { person: 'moves a running task into or out of their own checkout: only they say when it switches' },
  dropMove: { person: 'calls off a move into or out of their own checkout' },
  workToward: { tool: 'work_toward' },
  runIt: { person: 'says how far to trust a pull request’s code: a lead’s run_it only relays their word' },
  shelve: { tool: 'change_part' },
  savePreset: { person: 'keeps a task’s parts as a preset of their own, in their settings' },
  handOverHeld: { tool: 'change_lead' },
  answerQuestion: { person: 'answers what an agent asked them' },
  // The Change card.
  markReady: { tool: 'mark_ready' },
  postScreenshots: { own: 'finish_step' },
  markAllReady: { tool: 'mark_ready' },
  openChange: { tool: 'open_task_pull_request' },
  mergeHere: { word: 'accept_task' },
  pushHere: { word: 'push_accepted_task' },
  pushBranch: { tool: 'push_task_branch' },
  accept: { word: 'merge_pull_request' },
  mergeWaiting: { word: 'merge_pull_request' },
  push: { tool: 'push_task' },
  ship: { tool: 'ship_task' },
  fixAfterMerge: { tool: 'answer_review_after_merge' },
  leaveAfterMerge: { tool: 'answer_review_after_merge' },
  replace: { person: 'a force push, which can’t be undone: the person confirms what it replaces' },
  mergeNote: { tool: 'message_lead' },
  stopListening: { tool: 'stop_following' },
  // A review's draft and the issue cards.
  changeReview: { own: 'draft_review' },
  postReview: { person: 'speaks for the person to others on the code host' },
  postReviewsFromNow: { person: 'lets reviews speak for the person from now on' },
  discardReview: { tool: 'settle_task' },
  fileIssueDraft: { tool: 'draft_issue' },
  changeIssueDraft: { tool: 'draft_issue' },
  discardIssueDraft: { person: 'throws away a card the person was asked to file' },
  applyIssueChanges: { tool: 'change_issues' },
  discardIssueChanges: { person: 'throws away a card the person was asked to apply' },
  preferIssueCards: { tool: 'keep_note' },
  setIssuePart: { tool: 'set_part_of_issue' },
  // What runs.
  stopBackground: { own: 'stop_task' },
  stopHolding: { own: 'stop_task' },
  clearBackground: { window: 'clears a finished command from the list' },
  runProject: { tool: 'run_project' },
  stopLaunch: { tool: 'stop_project' },
  clearLaunch: { window: 'clears a finished run from Run’s list' },
  dismissError: { window: 'hides an error' },
} as const satisfies Readonly<Record<string, WindowAction>>

export type WindowActionName = keyof typeof WINDOW_ACTIONS
