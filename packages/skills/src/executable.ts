/** A file an agent could run: a script by its extension, or anything under a `scripts/` folder. Althar never runs one. */
export const looksExecutable = (path: string): boolean =>
  /\.(sh|bash|zsh|js|cjs|mjs|ts|py|rb|pl|ps1|bat|cmd)$/.test(path) || /(^|\/)scripts\//.test(path)
