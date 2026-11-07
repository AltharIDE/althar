/*
 * Each conversation's pages keep their cookies and storage in a session of
 * their own (ADR-100): a task's in `persist:task-<id>`, a project's
 * coordinator's in `persist:project-<id>`, apart from Althar's, the
 * person's browser's and each other's. How long they keep them is the
 * person's choice (Settings › Browser); what is kept goes at the moment that
 * choice names. Pure, so the window shares the words and the choices.
 */

/** How long pages keep cookies and storage: until the page closes, until Althar quits, until the task is done, or as long as each site asks. */
export type CookieKeep = 'page' | 'quit' | 'task' | 'site'

export const COOKIE_KEEPS: ReadonlyArray<CookieKeep> = ['page', 'quit', 'task', 'site']

export const isCookieKeep = (value: unknown): value is CookieKeep =>
  typeof value === 'string' && (COOKIE_KEEPS as ReadonlyArray<string>).includes(value)

/**
 * The moments a session's data can go: its page closed beside the
 * conversation, Althar quitting, Althar starting (what a quit cut short
 * left), and its task done or abandoned, or its project removed.
 */
export type Moment = 'closed' | 'quit' | 'started' | 'settled'

/**
 * Whether a session's data goes at a moment, as the person keeps it: each
 * choice at its own moment, and a page's at every one; what a task done or a
 * project removed kept goes too, but where sites keep their own.
 */
export const clearsAt = (keep: CookieKeep, moment: Moment): boolean => {
  switch (keep) {
    case 'page':
      return true
    case 'quit':
      return moment !== 'closed'
    case 'task':
      return moment === 'settled'
    case 'site':
      return false
  }
}

/** Whose pages: a task's, or a project's coordinator's. */
export interface Owner {
  readonly kind: 'task' | 'project'
  /** Its id, as the runtime has it: `task_…` or `proj_…`. */
  readonly id: string
}

const TASK = /^task_([0-9a-f]{32})$/
const PROJECT = /^proj_([0-9a-f]{32})$/

/** The owner an id names, where it is a task's or a project's; null for anything else, which never gets a page. */
export const ownerOf = (id: unknown): Owner | null => {
  if (typeof id !== 'string') return null
  if (TASK.test(id)) return { kind: 'task', id }
  if (PROJECT.test(id)) return { kind: 'project', id }
  return null
}

/** The persistent partition an owner's pages keep their data in. */
export const partitionOf = (owner: Owner): string => `persist:${owner.kind}-${owner.id.slice(owner.id.indexOf('_') + 1)}`

/** The owner a partition's folder belongs to (`task-<hex>`, as Electron names it on disk), or null for one that isn't a page's. */
export const ownerOfFolder = (folder: string): Owner | null => {
  const found = /^(task|project)-([0-9a-f]{32})$/.exec(folder)
  if (found === null) return null
  return found[1] === 'task' ? { kind: 'task', id: `task_${found[2]}` } : { kind: 'project', id: `proj_${found[2]}` }
}
