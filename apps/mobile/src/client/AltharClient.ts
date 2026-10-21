import type {
  AlwaysScope,
  BoardSnapshot,
  Disposition,
  FieldAnswer,
  FileDiff,
  HomeSnapshot,
  TaskSummary,
  ThreadSnapshot,
  WatchEvent,
} from '@althar/contracts'

/*
 * What the phone asks of Althar on the paired Mac: the runtime's own API
 * (packages/contracts), the calls a phone needs, by the same names and with
 * the same shapes. Two clients implement it: the demo, which runs in the
 * app on its own data, and the relay's, which reaches the runtime through
 * the relay (ADR-048). Commands take no id here: the client makes one
 * (`cmd_` and 32 hex digits), so a retry is answered from the first.
 */

/** The Mac the phone is paired with, as the pairing named it. */
export type PairedMac = {
  readonly name: string
  readonly pairedAt: string
  /** The words both screens showed when they paired, to check no one sat between them. */
  readonly words: ReadonlyArray<string>
}

/**
 * How the phone stands with the Mac. The Mac is canonical: the phone sees
 * Althar only while the Mac is awake and Althar runs, and says so when it
 * isn't (ADR-048).
 */
export type Connection =
  | { readonly state: 'unpaired' }
  | { readonly state: 'connecting'; readonly mac: PairedMac }
  | { readonly state: 'online'; readonly mac: PairedMac }
  /** The relay can't reach the Mac: asleep, offline, or Althar isn't running. What the phone shows is as of `lastSeen`. */
  | { readonly state: 'away'; readonly mac: PairedMac; readonly lastSeen: string }
  /** The Mac's runtime speaks another version of the API (`API_VERSION`): one of the two needs updating before they can talk. */
  | { readonly state: 'outdated'; readonly mac: PairedMac; readonly ours: number; readonly theirs: number }

export type Unsubscribe = () => void

export interface AltharClient {
  connection(): Connection
  onConnection(listener: (connection: Connection) => void): Unsubscribe
  /**
   * Pairs with the Mac whose code was scanned: the relay's, not the
   * runtime's. The phone makes its own key, which never leaves it; the Mac
   * keeps its public half, and can unpair it.
   */
  pair(code: string): Promise<PairedMac>
  unpair(): Promise<void>

  /** GetHome: every project, what waits on the person, what runs, and what the loop did since they last looked. */
  home(): Promise<HomeSnapshot>
  /** GetBoard: a project's tasks, by card, and its calls. */
  board(projectId: string): Promise<BoardSnapshot>
  /** GetThread: a task's thread, newest items. */
  thread(threadId: string): Promise<ThreadSnapshot>
  /** GetFileDiff: one file a task changed. */
  fileDiff(taskId: string, path: string): Promise<FileDiff>
  /** Watch: what changes, as it happens. */
  watch(listener: (event: WatchEvent) => void): Unsubscribe

  /** Answer: a permission, once or always. */
  answer(input: {
    readonly attentionId: string
    readonly decision: 'allow' | 'reject'
    readonly reason?: string
    readonly always?: AlwaysScope
  }): Promise<void>
  /** AnswerQuestion: an agent's question, field by field. */
  answerQuestion(input: { readonly attentionId: string; readonly answers: Readonly<Record<string, FieldAnswer>> }): Promise<void>
  /** AnswerStuck: a step that can't go on without the person. */
  answerStuck(input: {
    readonly attentionId: string
    readonly answer:
      | { readonly kind: 'tell'; readonly note: string }
      | { readonly kind: 'retry'; readonly agentId: string; readonly model?: string }
      | { readonly kind: 'wait' }
      | { readonly kind: 'abandon' }
  }): Promise<void>
  /** Send: a message to a task's lead, or to a project's coordinator. */
  send(input: {
    readonly threadId: string
    readonly body: string
    readonly disposition: typeof Disposition.Type
    readonly dictated?: boolean
  }): Promise<void>
  /** CreateTask: a new task in a project, which the coordinator plans. */
  createTask(input: { readonly projectId: string; readonly title: string; readonly description?: string }): Promise<TaskSummary>
  stopTask(taskId: string): Promise<void>
  markTaskDone(taskId: string): Promise<void>
  keepTaskForLater(taskId: string): Promise<void>
  /** Merge: a ready change, at the head the person saw. */
  merge(input: { readonly taskId: string; readonly head: string }): Promise<void>
}
