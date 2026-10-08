/** A repository's role, as an agent's brief says it: "meridian-web, the frontend". Other says nothing. */
export const roleWords: Readonly<Record<string, string>> = {
  service: 'a service',
  frontend: 'the frontend',
  infrastructure: 'infrastructure',
  library: 'a library',
  docs: 'docs',
}

/** A repository by its name, with its role where it has one: `meridian-web, the frontend`. */
export const withRole = (name: string, role: string) => (roleWords[role] === undefined ? name : `${name}, ${roleWords[role]}`)
