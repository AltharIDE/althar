/** How much room a model has where work on it would start: the share left of the tightest window of the account the work would go to. */
export interface ModelRoom {
  /** 0 to 100. */
  left: number
  /** When that window resets, as the consumer words a time: 14:00, Mon 09:00. */
  until: string | null
  /** The account, where the agent has several. */
  account: string | null
}
