/**
 * The SHA-256 of each released migration's statements. A test compares them
 * with the migrations, so a released migration cannot change unnoticed. Add a
 * line here when you add a migration; never change an existing line.
 */
export const checksums: Readonly<Record<string, string>> = {
  '0001_initial': '814d7f4e21eccfea492fa1f89c54950daca9db0c0a528d40f8b25c2cfd1f4555',
  '0002_permission_scope_turn': '7507e9be0e6d5b27ebd1606624594b233626fe7f22a4011172fd97364e87951f',
  '0003_thread_items': '5f7480639b03a33318df2a36cf7688b64900a85ce122056282c291c43bffda74',
  '0004_coordinator': '3374d9557030cfd42b504746427a34cf3c8821e77ba638c99272a22b6fd3c496',
  '0005_run_per_plan': '545054f6f27da6e57b072120a2e2c28e69e41f6f699474c7662467f4edd959dc',
  '0006_connectors': '0dbeece0ec09e4ac1b4c344927f3e91392f2b2109e5fd3a06cefcb14c4e83ae0',
  '0007_models': '88b3d1b7753108776939ea905b070239acaa999b5550454d6b7ef6216a746f78',
  '0008_usage_limits': '9d040fe14f50190f266317abe7c7a92f95be9c902a3701e0d8e637b9e898ed69',
  '0009_accounts': '80be008b6fe8da401f0a2a31fa59631cadc0ad6eb8ea89ddc157c3ccd78b35c5',
}
