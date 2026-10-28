/*
 * Where people keep keys, tokens and sign-ins under their home folder, as
 * paths from it: a file, or a folder and everything in it. No agent reads
 * them, in any role or project (ADR-013's "reading credentials"): the
 * runtime's rules refuse a request that names one, and a Claude Code
 * session is given them as reads it denies, which its sandbox applies to the
 * shell commands it runs without asking (registry.ts). One list, so the two
 * never drift.
 */

export const SECRET_PLACES: ReadonlyArray<string> = [
  '.ssh',
  '.aws',
  '.azure',
  '.config/gcloud',
  '.kube',
  '.docker/config.json',
  '.gnupg',
  '.password-store',
  '.netrc',
  '.git-credentials',
  // Git's credential store where XDG_CONFIG_HOME isn't set, its passwords in plain text.
  '.config/git/credentials',
  '.npmrc',
  '.pypirc',
  '.gem/credentials',
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.config/gh',
  '.config/glab-cli',
  '.config/hub',
  '.vault-token',
  '.terraform.d/credentials.tfrc.json',
  '.pgpass',
  '.my.cnf',
  '.boto',
  '.s3cfg',
  'Library/Keychains',
  '.local/share/keyrings',
  '.claude/.credentials.json',
  '.codex/auth.json',
]

/** The places as Claude Code's read rules name them, from the home folder: each, and everything in it. */
export const secretReadRules = (): ReadonlyArray<string> => SECRET_PLACES.flatMap((place) => [`Read(~/${place})`, `Read(~/${place}/**)`])
