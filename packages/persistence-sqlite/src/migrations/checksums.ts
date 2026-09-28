/**
 * The SHA-256 of each released migration's statements. A test compares them
 * with the migrations, so a released migration cannot change unnoticed. Add a
 * line here when you add a migration; never change an existing line.
 */
export const checksums: Readonly<Record<string, string>> = {
  '0001_initial': 'd2a8400012a35b65368c0f27308adf61548797a38b0115096036ee9f0fc1f252',
}
