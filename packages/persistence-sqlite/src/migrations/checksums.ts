/**
 * The SHA-256 of each released migration's statements. A test compares them
 * with the migrations, so a released migration cannot change unnoticed. Add a
 * line here when you add a migration; never change an existing line.
 */
export const checksums: Readonly<Record<string, string>> = {
  '0001_initial': '814d7f4e21eccfea492fa1f89c54950daca9db0c0a528d40f8b25c2cfd1f4555',
}
