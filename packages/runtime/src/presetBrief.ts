/*
 * What the coordinator and a task's lead are told of presets (a task is a conversation plus parts): to plan from the one that
 * fits what the person asked, and that a prototype may or may not go on as a change. One text, so the brief and the tools say the
 * same.
 */

/** Which preset fits what, as list_presets names them. */
const WHICH =
  'Prototype for a prototype or design directions, Small change for a few lines (with small_change: starts at once and keeps its configured review before Ship), Chat for a question or a look, Review a PR for a review of a pull request (review_pull_request starts that one), and Change for the rest. The person’s own presets count too: where one of theirs fits what they asked, plan from it.'

/** The prototype's way: it ends with its branch, and may later be built; the person decides then. */
const PROTOTYPES =
  'A prototype ends with its branch: no review and no pull request. If the person later wants it built, the same task goes on as a change, rather than a new task by default: change_part with preset Change gives it its reviewer and its pull request ending in one move, and Ship then runs the review and opens the pull request; or it never does. The person decides, so never assume either way: don’t add a review or a pull request to a prototype, and don’t plan its build until they ask.'

/** The agent judges whether a title still fits; rename_task keeps an open pull request in step. */
export const TITLES_FOLLOW_WORK =
  'Whenever a task’s scope or shape changes, check whether its title still says what it does now, including a prototype becoming a real change or a change becoming a prototype or chat. If the title is out of date, call rename_task with its id or slug and a concise title for the work now, without asking the person again. An open pull request Althar opened for it follows the new title by the project’s naming. Keep a title that still fits.'

/**
 * Every part of a task changes either way on the person's word, at once (the person's note of 12 November): what the
 * coordinator and every lead are told, so none refuses, detours or asks them again.
 */
export const PARTS_CHANGE = `Every part of a task changes at any time, either way, just by the person saying so to its lead or to the coordinator, in plain words or by voice, with no UI needed: its review, its ending, its preset’s shape, where it works, and its lead’s model and effort. Act on their word at once, on any task they name, your own included, and say what you did in a line: change_part (preset for another preset’s parts all at once, such as a prototype made a Change or a change made a Prototype or a Chat; checked_by for its review, on, changed or off; ending for here, its branch, a draft or a ready pull request; workspace for a worktree or Local; shelf), and change_lead for its lead’s model and effort. Never refuse, detour to a new task, or ask them again for what they just said; offer_review is only for where they didn’t say whether they want a review. ${TITLES_FOLLOW_WORK}`

/** What a coordinator's brief says: call list_presets, plan from the one that fits, and what a prototype is. */
export const PLAN_FROM_PRESETS = `Plan from a preset. Before propose_plan, call list_presets and plan from the one that fits what the person asked, with propose_plan's preset: ${WHICH} A preset sets its lead and reviewer where it names them, how it is checked, its ending, where it works and a few lines of brief, so leave out a review for one that has none, and pick the reviewer, from another maker than its lead's, only for one that needs it. ${PROTOTYPES}`

/** What a lead's brief says, for the tasks it drafts. */
export const LEAD_PLANS_FROM_PRESETS = `Where you draft a task, plan it from a preset: call list_presets, then propose_plan with the preset that fits what the person asked: ${WHICH} ${PROTOTYPES} The same goes for your own task where it began as a prototype: it ends with its branch until the person says otherwise, and you never open a pull request or ask for a review of it on your own.`

/** What draft_task's description says. */
export const DRAFT_THEN_PRESET =
  'Then propose its plan from the preset that fits what the person asked (list_presets): Prototype for a prototype or design directions, Small change for a few lines, Chat for a question or a look, Review a PR for a review, and Change for the rest, the person’s own presets included.'

/** What propose_plan's `preset` and list_presets say. */
export const PICK_A_PRESET =
  'Call list_presets first and plan from the one that fits what the person asked: Prototype for a prototype or design directions (it ends with its branch, with no review), Small change for a few lines, Chat for a question or a look, Review a PR for a review, and Change for the rest; the person’s own presets count too.'
