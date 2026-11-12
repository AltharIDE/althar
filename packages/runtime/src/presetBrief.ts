/*
 * What the coordinator and a task's lead are told of presets (a task is a conversation plus parts): to plan from the one that
 * fits what the person asked, and that a prototype may or may not go on as a change. One text, so the brief and the tools say the
 * same.
 */

/** Which preset fits what, as list_presets names them. */
const WHICH =
  'Prototype for a prototype or design directions, Small change for a few lines (with small_change), Chat for a question or a look, Review a PR for a review of a pull request (review_pull_request starts that one), and Change for the rest. The person’s own presets count too: where one of theirs fits what they asked, plan from it.'

/** The prototype's way: it ends with its branch, and may later be built; the person decides then. */
const PROTOTYPES =
  'A prototype ends with its branch: no review and no pull request. If the person later wants it built, the same task can go on as a change, with its pull request ending and its review added then, rather than a new task by default; or it never does. The person decides, so never assume either way: don’t add a review or a pull request to a prototype, and don’t plan its build until they ask.'

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
