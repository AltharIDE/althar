import type { AccessList } from '../src'

/** An id of a kind, from a number: `id('team', 2)` is `team_000…002`. */
export const id = (prefix: string, n: number): string => `${prefix}_${n.toString(16).padStart(32, '0')}`

export const T = {
  markets: id('team', 1),
  fx: id('team', 2),
  payments: id('team', 3),
  design: id('team', 4),
}
export const P = {
  owner: id('act', 1),
  ana: id('act', 2),
  ben: id('act', 3),
  sofia: id('act', 4),
  gus: id('act', 5),
  bill: id('act', 6),
  pam: id('act', 7),
  ada: id('act', 8),
}
export const PROJ = { fx: id('proj', 1), payments: id('proj', 2), secret: id('proj', 3), company: id('proj', 4) }
export const REPO = { web: id('repo', 1), api: id('repo', 2), design: id('repo', 3) }
export const FN = { frontend: id('fn', 1), qa: id('fn', 2), design: id('fn', 3), quant: id('fn', 4) }
export const SVC = { ci: id('svc', 1) }

export const NOW = Date.parse('2025-11-26T12:00:00.000Z')

const person = (over: Partial<AccessList['people'][number]> & Pick<AccessList['people'][number], 'id' | 'name'>) => ({
  role: 'member' as const,
  teams: [],
  functions: [],
  projectFunctions: [],
  passkeys: [],
  ...over,
})

/** Northbank: Markets holds FX Manager and Payments; Design Studio sits beside it. */
export const northbank: AccessList = {
  catalog: 1,
  home: id('home', 1),
  organization: id('org', 1),
  revision: 7,
  issuedAt: '2025-11-26T11:00:00.000Z',
  expiresAt: '2025-11-27T11:00:00.000Z',
  baseAccess: null,
  membersMayInvite: false,
  membersMayCreateProjects: true,
  teams: [
    { id: T.markets, name: 'Markets', parent: null, defaultAccess: 'view' },
    { id: T.fx, name: 'FX Manager', parent: T.markets, defaultAccess: 'contribute' },
    { id: T.payments, name: 'Payments', parent: T.markets, defaultAccess: 'contribute' },
    { id: T.design, name: 'Design Studio', parent: null, defaultAccess: 'contribute' },
  ],
  functions: [
    { id: FN.frontend, name: 'Frontend', team: null },
    { id: FN.qa, name: 'QA', team: null },
    { id: FN.design, name: 'Design', team: null },
    { id: FN.quant, name: 'Quant', team: T.fx },
  ],
  people: [
    person({ id: P.owner, name: 'Olivia', role: 'owner' }),
    person({ id: P.ana, name: 'Ana', teams: [{ team: T.fx, admin: false }], functions: [FN.frontend, FN.qa] }),
    person({ id: P.ben, name: 'Ben', teams: [{ team: T.fx, admin: true }] }),
    person({ id: P.sofia, name: 'Sofia', teams: [{ team: T.design, admin: false }], functions: [FN.design] }),
    person({ id: P.gus, name: 'Gus', role: null }),
    person({ id: P.bill, name: 'Bill', role: 'billing_manager' }),
    person({ id: P.pam, name: 'Pam', teams: [{ team: T.payments, admin: false }] }),
    person({ id: P.ada, name: 'Ada', teams: [{ team: T.markets, admin: true }] }),
  ],
  serviceAccounts: [{ id: SVC.ci, name: 'CI' }],
  projects: [
    { id: PROJ.fx, team: T.fx, private: false },
    { id: PROJ.payments, team: T.payments, private: false },
    { id: PROJ.secret, team: T.fx, private: true },
    { id: PROJ.company, team: null, private: false },
  ],
  grants: [
    {
      id: id('grant', 1),
      principal: { kind: 'person', id: P.sofia },
      project: PROJ.fx,
      access: 'contribute',
      writes: [REPO.design],
      readsOthers: true,
      expiresAt: null,
    },
    {
      id: id('grant', 2),
      principal: { kind: 'person', id: P.gus },
      project: PROJ.payments,
      access: 'contribute',
      writes: null,
      readsOthers: false,
      expiresAt: '2025-12-01T00:00:00.000Z',
    },
    {
      id: id('grant', 3),
      principal: { kind: 'service_account', id: SVC.ci },
      project: PROJ.fx,
      access: 'maintain',
      writes: null,
      readsOthers: false,
      expiresAt: null,
    },
    {
      id: id('grant', 4),
      principal: { kind: 'person', id: P.ana },
      project: PROJ.secret,
      access: 'view',
      writes: null,
      readsOthers: false,
      expiresAt: null,
    },
  ],
}
