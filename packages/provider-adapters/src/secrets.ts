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

/**
 * The code-host command-line tools' own folders, where gh, glab and hub keep
 * their settings and the person's sign-in. Agents' commands inherit that
 * sign-in (ADR-097), so their sandboxes let the tools read these: denied,
 * `gh` doesn't start (`open …/config.yml: operation not permitted`). A
 * command or read that names one is still refused by Althar's rules, as
 * every place here is: the tool reads it, the agent doesn't.
 */
export const CLI_SIGN_INS: ReadonlyArray<string> = ['.config/gh', '.config/glab-cli', '.config/hub']

/** Where keys and sign-ins are kept that an agent's sandboxed commands don't read: all but the code-host tools' own. */
export const SANDBOX_SECRETS: ReadonlyArray<string> = SECRET_PLACES.filter((place) => !CLI_SIGN_INS.includes(place))

/**
 * The places as Claude Code's read rules name them, from the home folder:
 * each, and everything in it. Claude Code's sandbox denies its commands
 * reading these too, so the code-host tools' own folders aren't among them.
 */
export const secretReadRules = (): ReadonlyArray<string> => SANDBOX_SECRETS.flatMap((place) => [`Read(~/${place})`, `Read(~/${place}/**)`])
