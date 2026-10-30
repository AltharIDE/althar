/* Desktop test setup imports the UI before a spec can set window.althar, so its
   module-scoped key helpers already hold the default Mac platform. Cross-platform
   integration tests override only those exports here; the UI tests cover the real helpers. */
export const keysFor = (platform: string) => {
  const isMac = platform === 'darwin'
  const keys = {
    mod: isMac ? '⌘' : 'Ctrl',
    alt: isMac ? '⌥' : 'Alt',
    shift: isMac ? '⇧' : 'Shift',
    enter: isMac ? '↵' : 'Enter',
    return: isMac ? '⏎' : 'Enter',
  }
  const chord = (...parts: ReadonlyArray<string>) => parts.join(isMac ? '' : '+')
  return {
    keys,
    chord,
    modKey: (key: string) => chord(keys.mod, key),
    primaryDown: (event: { readonly metaKey: boolean; readonly ctrlKey: boolean }) =>
      isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
    commandDown: (event: { readonly metaKey: boolean; readonly ctrlKey: boolean }) =>
      isMac ? event.metaKey || event.ctrlKey : event.ctrlKey,
  }
}
