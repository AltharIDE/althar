/** One of the directions a part can take, while it is chosen: its key on the bar, its name, and what it is. */
export interface Direction<T> {
  key: string
  name: string
  value: T
}
