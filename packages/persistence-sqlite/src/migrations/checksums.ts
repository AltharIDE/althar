/**
 * The SHA-256 of each released migration's statements. A test compares them
 * with the migrations, so a released migration cannot change unnoticed. Add a
 * line here when you add a migration; never change an existing line.
 */
export const checksums: Readonly<Record<string, string>> = {
  '0001_initial': '47643c79246ec0042e03713d92f4f7f0274d1faf3e32651d03f42dee38d9dc6a',
}
