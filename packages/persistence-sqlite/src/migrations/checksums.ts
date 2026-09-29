/**
 * The SHA-256 of each released migration's statements. A test compares them
 * with the migrations, so a released migration cannot change unnoticed. Add a
 * line here when you add a migration; never change an existing line.
 */
export const checksums: Readonly<Record<string, string>> = {
  '0001_initial': '814d7f4e21eccfea492fa1f89c54950daca9db0c0a528d40f8b25c2cfd1f4555',
  '0002_permission_scope_turn': '7507e9be0e6d5b27ebd1606624594b233626fe7f22a4011172fd97364e87951f',
  '0003_thread_items': '5f7480639b03a33318df2a36cf7688b64900a85ce122056282c291c43bffda74',
}
