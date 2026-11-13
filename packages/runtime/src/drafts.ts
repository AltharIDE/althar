/*
 * The tasks a coordinator is drafting now, as far as it has written them, so
 * the window can show a task's card from the moment its draft begins rather
 * than once its plan is in (`TaskLaunch`'s drafting state).
 *
 * It follows the coordinator's own calls to draft_task and propose_plan as
 * they stream: Claude Code sends a call as it begins, then its input again
 * each time a field of it is written; agents that send a call only whole give
 * it all at once. The draft_task handler says which task each draft became,
 * so a draft shows even where its calls never came as events. Nothing here is
 * kept: it lasts the coordinator's turn, and the plan's card is the record.
 *
 * This is the pure part: what a thread's drafts are after each thing seen.
 * Choosing who a step's model is, from the name the coordinator wrote, is the
 * caller's (`stepOf`).
 */

/** Who does a step, as the plan will say it. */
export interface DraftStep {
  readonly agentId: string
  readonly model: string | null
  readonly effort: string | null
}

/** A step's pick as the coordinator wrote it, before it is resolved. */
export interface WrittenPick {
  readonly model?: string
  readonly agent?: string
  readonly effort?: string | null
}

export interface Draft {
  /** Stable while it lasts: its draft_task call's id, or its task's where no call was seen. */
  readonly key: string
  /** Its title, once written; null before. */
  readonly title: string | null
  /** Its description is written. */
  readonly brief: boolean
  /** The task it became, once drafted. */
  readonly taskId: string | null
  readonly slug: string | null
  /** Its plan is being written. */
  readonly planning: boolean
  /** Its lead, once written and known. */
  readonly lead: DraftStep | null
  /** Its reviewer, once written and known; `noReview` once planned without one. */
  readonly review: DraftStep | null
  readonly noReview: boolean
  /** The preset its plan names, once written. */
  readonly preset: string | null
  /** Its plan is in: its card is in the thread now. */
  readonly planned: boolean
}

/** A call being followed: which draft it writes. */
interface Call {
  readonly tool: 'draft_task' | 'propose_plan'
  readonly draft: string | null
}

export interface Drafts {
  readonly drafts: ReadonlyArray<Draft>
  readonly calls: ReadonlyMap<string, Call>
}

export const noDrafts: Drafts = { drafts: [], calls: new Map() }

/** The tools followed. */
export const FOLLOWED = new Set(['draft_task', 'propose_plan'])

const blank = (key: string): Draft => ({
  key,
  title: null,
  brief: false,
  taskId: null,
  slug: null,
  planning: false,
  lead: null,
  review: null,
  noReview: false,
  preset: null,
  planned: false,
})

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

const change = (state: Drafts, key: string, patch: (draft: Draft) => Draft): Drafts => ({
  ...state,
  drafts: state.drafts.map((draft) => (draft.key === key ? patch(draft) : draft)),
})

/** A pick as written, where the coordinator has written one: a model or an agent named. */
export const writtenPick = (value: unknown): WrittenPick | undefined => {
  const pick = record(value)
  if (pick === undefined) return undefined
  const model = text(pick['model'])
  const agent = text(pick['agent'])
  if (model === undefined && agent === undefined) return undefined
  const effort = pick['effort']
  return {
    ...(model === undefined ? {} : { model }),
    ...(agent === undefined ? {} : { agent }),
    ...(typeof effort === 'string' || effort === null ? { effort } : {}),
  }
}

/** A call to one of the tools followed began. */
export const callBegan = (state: Drafts, callId: string, tool: 'draft_task' | 'propose_plan'): Drafts => {
  if (state.calls.has(callId)) return state
  const calls = new Map(state.calls)
  if (tool === 'draft_task') {
    calls.set(callId, { tool, draft: callId })
    return { drafts: [...state.drafts, blank(callId)], calls }
  }
  // A plan's call names its task first; until it does, it is the plan of the one draft waiting for one, where there is one.
  const waiting = state.drafts.filter((draft) => !draft.planning && !draft.planned)
  const draft = waiting.length === 1 ? (waiting[0]?.key ?? null) : null
  calls.set(callId, { tool, draft })
  const next = { ...state, calls }
  return draft === null ? next : change(next, draft, (one) => ({ ...one, planning: true }))
}

/**
 * A followed call's input as far as it is written. What a plan's input names
 * of who does its steps comes back as picks to resolve (`resolved`).
 */
export const inputWritten = (
  state: Drafts,
  callId: string,
  input: unknown,
): { readonly state: Drafts; readonly lead?: WrittenPick; readonly review?: WrittenPick } => {
  const call = state.calls.get(callId)
  const fields = record(input)
  if (call === undefined || fields === undefined) return { state }
  if (call.tool === 'draft_task') {
    const title = text(fields['title'])
    const brief = typeof fields['description'] === 'string'
    if (call.draft === null) return { state }
    return {
      state: change(state, call.draft, (draft) => ({
        ...draft,
        ...(title === undefined || draft.taskId !== null ? {} : { title }),
        brief: draft.brief || brief,
      })),
    }
  }
  // A plan: the draft it is for, by its slug, once named.
  let next = state
  let key = call.draft
  const slug = text(fields['task'])
  if (slug !== undefined) {
    const named = state.drafts.find((draft) => draft.slug === slug)
    if (named !== undefined && named.key !== key) {
      key = named.key
      const calls = new Map(state.calls)
      calls.set(callId, { ...call, draft: key })
      // A plan once taken for another draft's leaves it waiting again.
      next = { ...state, calls }
      if (call.draft !== null) next = change(next, call.draft, (draft) => (draft.planned ? draft : { ...draft, planning: false }))
    }
  }
  if (key === null) return { state: next }
  const preset = text(fields['preset'])
  const lead = writtenPick(fields['lead'])
  const review = fields['review'] === null ? null : writtenPick(fields['review'])
  next = change(next, key, (draft) => ({
    ...draft,
    planning: true,
    ...(preset === undefined ? {} : { preset }),
    ...(review === null ? { noReview: true, review: null } : {}),
  }))
  return {
    state: next,
    ...(lead === undefined ? {} : { lead }),
    ...(review === null || review === undefined ? {} : { review }),
  }
}

/** Who a plan's step is, resolved from what was written; for the draft its call writes. */
export const resolved = (state: Drafts, callId: string, step: 'lead' | 'review', who: DraftStep): Drafts => {
  const key = state.calls.get(callId)?.draft
  if (key === null || key === undefined) return state
  return change(state, key, (draft) => ({ ...draft, [step]: who, ...(step === 'review' ? { noReview: false } : {}) }))
}

/** A followed call ended: a plan that went through is in its card now; one that failed leaves its draft waiting for another. */
export const callEnded = (state: Drafts, callId: string, ok: boolean): Drafts => {
  const call = state.calls.get(callId)
  if (call === undefined) return state
  const calls = new Map(state.calls)
  calls.delete(callId)
  const next = { ...state, calls }
  if (call.draft === null) return next
  if (call.tool === 'draft_task')
    // A draft that failed is no task: it goes, unless the handler said it became one.
    return ok ? next : { ...next, drafts: next.drafts.filter((draft) => draft.key !== call.draft || draft.taskId !== null) }
  return change(next, call.draft, (draft) =>
    ok
      ? { ...draft, planned: true, planning: false }
      : { ...blank(draft.key), title: draft.title, brief: draft.brief, taskId: draft.taskId, slug: draft.slug },
  )
}

/**
 * draft_task made a task: the draft it was is that task now. It is the
 * draft of that title still waiting for its task, else the oldest waiting;
 * where none is (its call never came as events), a draft of its own.
 */
export const drafted = (state: Drafts, task: { readonly taskId: string; readonly slug: string; readonly title: string }): Drafts => {
  if (state.drafts.some((draft) => draft.taskId === task.taskId)) return state
  const waiting = state.drafts.filter((draft) => draft.taskId === null)
  const draft = waiting.find((one) => one.title === task.title) ?? waiting[0]
  const made = (one: Draft): Draft => ({ ...one, title: task.title, brief: true, taskId: task.taskId, slug: task.slug })
  if (draft === undefined) return { ...state, drafts: [...state.drafts, made(blank(`task:${task.taskId}`))] }
  return change(state, draft.key, made)
}

/** The turn ended: drafts that never got their plan go (the board shows them as stopped); planned ones are in their cards. */
export const turnEnded = (): Drafts => noDrafts
