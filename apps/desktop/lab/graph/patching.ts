/** A line patched in one of the app's own files: `from` replaced by `to`, or `to` put at the top where `from` is empty. */
export interface Patch {
  readonly file: string
  readonly from: string
  readonly to: string
}
