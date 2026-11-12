/*
 * What a tool call says to the person, in plain words. An agent names an MCP
 * tool `mcp__<server>__<tool>` (Claude Code) or `mcp.<server>.<tool>`
 * (Codex); that name is for the agent, never for the screen. Althar's own
 * tools read from a table ("Planning the task"); any other server's tool, or
 * one the table lacks, reads from its own name as words ("Searching issues").
 */

/** An MCP tool's server and tool, from the name an agent gives it; undefined for any other name. */
export const mcpNameOf = (name: string): { readonly server: string; readonly tool: string } | undefined => {
  const trimmed = name.trim()
  if (trimmed.startsWith('mcp__')) {
    const rest = trimmed.slice('mcp__'.length)
    const at = rest.indexOf('__', 1)
    if (at < 0) return undefined
    const server = rest.slice(0, at)
    const tool = rest.slice(at + 2)
    return /^[A-Za-z0-9_-]+$/.test(server) && /^[A-Za-z0-9_.-]+$/.test(tool) ? { server, tool } : undefined
  }
  if (trimmed.startsWith('mcp.')) {
    const [, server = '', ...tool] = trimmed.split('.')
    const joined = tool.join('.')
    return /^[A-Za-z0-9_-]+$/.test(server) && joined !== '' && /^[A-Za-z0-9_.-]+$/.test(joined) ? { server, tool: joined } : undefined
  }
  return undefined
}

/** A verb as a row says it: while it runs, once it is done, and as a plain request. */
const VERBS: Readonly<Record<string, readonly [running: string, done: string]>> = {
  Accept: ['Accepting', 'Accepted'],
  Add: ['Adding', 'Added'],
  Answer: ['Answering', 'Answered'],
  Approve: ['Approving', 'Approved'],
  Archive: ['Archiving', 'Archived'],
  Ask: ['Asking', 'Asked'],
  Attach: ['Attaching', 'Attached'],
  Cancel: ['Cancelling', 'Cancelled'],
  Change: ['Changing', 'Changed'],
  Check: ['Checking', 'Checked'],
  Click: ['Clicking', 'Clicked'],
  Close: ['Closing', 'Closed'],
  Comment: ['Commenting', 'Commented'],
  Compact: ['Compacting', 'Compacted'],
  Create: ['Creating', 'Created'],
  Delete: ['Deleting', 'Deleted'],
  Draft: ['Drafting', 'Drafted'],
  Drop: ['Dropping', 'Dropped'],
  Edit: ['Editing', 'Edited'],
  Fetch: ['Fetching', 'Fetched'],
  Find: ['Finding', 'Found'],
  Finish: ['Finishing', 'Finished'],
  Get: ['Getting', 'Got'],
  Hand: ['Handing', 'Handed'],
  Hold: ['Holding', 'Held'],
  Install: ['Installing', 'Installed'],
  Join: ['Joining', 'Joined'],
  Keep: ['Keeping', 'Kept'],
  Leave: ['Leaving', 'Left'],
  Link: ['Linking', 'Linked'],
  List: ['Listing', 'Listed'],
  Load: ['Loading', 'Loaded'],
  Look: ['Looking', 'Looked'],
  Mark: ['Marking', 'Marked'],
  Merge: ['Merging', 'Merged'],
  Message: ['Messaging', 'Messaged'],
  Move: ['Moving', 'Moved'],
  Navigate: ['Navigating', 'Navigated'],
  Offer: ['Offering', 'Offered'],
  Open: ['Opening', 'Opened'],
  Pause: ['Pausing', 'Paused'],
  Plan: ['Planning', 'Planned'],
  Press: ['Pressing', 'Pressed'],
  Propose: ['Proposing', 'Proposed'],
  Publish: ['Publishing', 'Published'],
  Push: ['Pushing', 'Pushed'],
  Query: ['Querying', 'Queried'],
  Read: ['Reading', 'Read'],
  Record: ['Recording', 'Recorded'],
  Remove: ['Removing', 'Removed'],
  Rename: ['Renaming', 'Renamed'],
  Reopen: ['Reopening', 'Reopened'],
  Reply: ['Replying', 'Replied'],
  Rerun: ['Rerunning', 'Reran'],
  Resolve: ['Resolving', 'Resolved'],
  Restart: ['Restarting', 'Restarted'],
  Resume: ['Resuming', 'Resumed'],
  Review: ['Reviewing', 'Reviewed'],
  Run: ['Running', 'Ran'],
  Save: ['Saving', 'Saved'],
  Scroll: ['Scrolling', 'Scrolled'],
  Search: ['Searching', 'Searched'],
  Select: ['Selecting', 'Selected'],
  Send: ['Sending', 'Sent'],
  Set: ['Setting', 'Set'],
  Settle: ['Settling', 'Settled'],
  Ship: ['Shipping', 'Shipped'],
  Show: ['Showing', 'Showed'],
  Skip: ['Skipping', 'Skipped'],
  Start: ['Starting', 'Started'],
  Stop: ['Stopping', 'Stopped'],
  Take: ['Taking', 'Took'],
  Try: ['Trying', 'Tried'],
  Type: ['Typing', 'Typed'],
  Update: ['Updating', 'Updated'],
  Wait: ['Waiting', 'Waited'],
  Work: ['Working', 'Worked'],
  Write: ['Writing', 'Wrote'],
}

/** Althar's own tools, as a request: its first word is the verb the row conjugates. */
const ALTHAR: Readonly<Record<string, string>> = {
  accept_task: 'Accept the task',
  add_part: 'Add a part to the task',
  add_review: 'Add a pull request review',
  answer_review_after_merge: 'Answer the review after the merge',
  answer_stuck_step: 'Answer the stuck step',
  approve_release_run: 'Approve the release run',
  attach_pull_request: 'Attach a pull request',
  cancel_errand: 'Cancel the errand',
  canvas_archive: 'Archive the canvas',
  canvas_get: 'Get the canvas',
  canvas_list: 'List the canvases',
  canvas_open: 'Open the canvas',
  canvas_publish: 'Publish the canvas',
  canvas_read: 'Read the canvas',
  canvas_resolve: 'Resolve a canvas comment',
  change_automation: 'Change the automation',
  change_issue: 'Change the issue',
  change_issues: 'Change the issues',
  change_lead: 'Change the lead',
  change_part: 'Change a part of the task',
  change_settings: 'Change the settings',
  close_pull_request: 'Close the pull request',
  comment_on_issue: 'Comment on the issue',
  compact_lead: 'Compact the lead’s conversation',
  create_branch: 'Create a branch',
  draft_issue: 'Draft an issue',
  draft_review: 'Draft a review',
  draft_task: 'Draft a task',
  drop_note: 'Drop a note',
  edit_pull_request: 'Edit the pull request',
  fetch_from_remote: 'Fetch from the remote',
  find_issues: 'Find issues',
  find_pull_requests: 'Find pull requests',
  find_tasks: 'Find tasks',
  finish_step: 'Finish the step',
  hand_checks_to_person: 'Hand the checks to the person',
  hold_task: 'Hold the task',
  install_dependencies: 'Install the dependencies',
  join_changes: 'Join the changes',
  keep_errand: 'Keep the errand',
  keep_note: 'Keep a note',
  keep_run: 'Keep a run command',
  leave_queue: 'Leave the merge queue',
  link_pull_request: 'Link the pull request',
  list_automations: 'List the automations',
  list_models: 'List the models',
  list_notes: 'List the notes',
  list_presets: 'List the presets',
  list_tasks: 'List the tasks',
  mark_ready: 'Mark the pull request ready',
  merge_pull_request: 'Merge the pull request',
  message_lead: 'Message the lead',
  move_to_front: 'Move the task to the front',
  offer_review: 'Offer a review',
  open_pull_request: 'Open a pull request',
  open_task_pull_request: 'Open the task’s pull request',
  page_click: 'Click on the page',
  page_dialog: 'Answer the page’s dialog',
  page_evaluate: 'Run a script on the page',
  page_hover: 'Hover on the page',
  page_logs: 'Read the page’s logs',
  page_move: 'Move the pointer on the page',
  page_open: 'Open the page',
  page_press: 'Press a key on the page',
  page_screenshot: 'Take a screenshot of the page',
  page_scroll: 'Scroll the page',
  page_select: 'Select on the page',
  page_snapshot: 'Read the page',
  page_state: 'Read the page’s state',
  page_type: 'Type on the page',
  page_viewport: 'Resize the page',
  page_wait: 'Wait for the page',
  pause_automation: 'Pause the automation',
  pause_errand: 'Pause the errand',
  project_overview: 'Read the project overview',
  propose_automation: 'Propose an automation',
  propose_plan: 'Plan the task',
  publish_release: 'Publish the release',
  push_accepted_task: 'Push the accepted task',
  push_tag: 'Push the tag',
  push_task: 'Push the task',
  push_task_branch: 'Push the task’s branch',
  push_to_pull_request: 'Push to the pull request',
  read_check_log: 'Read a check’s log',
  read_checks: 'Read the checks',
  read_default_branch_checks: 'Read the default branch’s checks',
  read_errands: 'Read the errands',
  read_issue: 'Read the issue',
  read_pull_request: 'Read the pull request',
  read_release: 'Read the release',
  read_release_steps: 'Read the release’s steps',
  read_settings: 'Read the settings',
  read_task: 'Read the task',
  read_task_diff: 'Read the task’s changes',
  read_thread: 'Read the thread',
  read_turn: 'Read the turn',
  record_setup: 'Record the setup',
  remove_part: 'Remove a part of the task',
  rename_task: 'Rename the task',
  reopen_pull_request: 'Reopen the pull request',
  reply_on_pull_request: 'Reply on the pull request',
  rerun_check: 'Rerun the check',
  rerun_failed_jobs: 'Rerun the failed jobs',
  resolve_conflicts: 'Resolve the conflicts',
  restart_task: 'Restart the task',
  resume_automation: 'Resume the automation',
  resume_errand: 'Resume the errand',
  review_after_merge: 'Review after the merge',
  review_pull_request: 'Review the pull request',
  run_automation_now: 'Run the automation now',
  run_it: 'Run it',
  run_project: 'Run the project',
  screenshot: 'Take a screenshot',
  set_part_of_issue: 'Set what the issue is part of',
  set_run_command: 'Set the run command',
  settle_task: 'Settle the task',
  ship_task: 'Ship the task',
  show_pictures: 'Show pictures',
  skip_review: 'Skip the review',
  start_change: 'Start a change',
  start_helper: 'Start a helper',
  start_task: 'Start a task',
  stop_following: 'Stop following the pull request',
  stop_helper: 'Stop the helper',
  stop_project: 'Stop the project',
  stop_task: 'Stop the task',
  try_again: 'Try again',
  update_branch: 'Update the branch',
  wait_for_person: 'Wait for the person',
  work_toward: 'Work toward a branch',
}

/** A tool's own name as a phrase: `create_pull_request_review` is "Create pull request review". */
const phraseOfName = (tool: string): string => {
  const words = tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((each) => each !== '')
  const phrase = words.join(' ')
  return phrase === '' ? 'Use a tool' : phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** The phrase for a tool of a server: Althar's own from its table, any other from its name. */
const phraseOf = (server: string | undefined, tool: string): string =>
  (server === undefined || /^althar$/i.test(server) ? ALTHAR[tool] : undefined) ?? phraseOfName(tool)

/** How far along a tool call is, as its words say it. */
export type ToolTense = 'plain' | 'running' | 'done'

/** A phrase's first word set in a tense, where it is a verb the rows know. */
export const inTense = (phrase: string, tense: ToolTense): string => {
  if (tense === 'plain') return phrase
  const space = phrase.indexOf(' ')
  const first = space < 0 ? phrase : phrase.slice(0, space)
  const verb = VERBS[first]
  if (verb === undefined) return phrase
  return `${verb[tense === 'running' ? 0 : 1]}${space < 0 ? '' : phrase.slice(space)}`
}

/** The name of an MCP tool in plain words, or undefined where `name` is not an MCP tool's. */
export const toolWordsOf = (name: string, tense: ToolTense = 'plain'): string | undefined => {
  const named = mcpNameOf(name)
  if (named !== undefined) return inTense(phraseOf(named.server, named.tool), tense)
  // Codex says Althar's own tools by the server, `althar.propose_plan`, or by the bare tool.
  const own = /^althar[.:/](.+)$/i.exec(name.trim())
  return own === null ? undefined : inTense(phraseOf('althar', own[1]!), tense)
}

/** What an MCP call to a server's tool did, in plain words, from the tool's own name. */
export const toolPhrase = (server: string, tool: string, tense: ToolTense = 'plain'): string => inTense(phraseOf(server, tool), tense)

/** A title that is an MCP tool's raw name, said in plain words; any other title, as it is. */
export const plainTitle = (title: string): string => toolWordsOf(title) ?? title
