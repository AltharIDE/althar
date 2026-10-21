/*
 * Whole screens, composed from the parts in @althar/ui: the first run,
 * the launch and what shows if opening fails an update couldn't move the data or the profile is open elsewhere, the ways to start, the home you come back to, a new project, a
 * project's rules and repositories, and its automations, each on its own page. They are one
 * product's compositions, kept apart from the parts so the parts' surface
 * stays general.
 */

export * from './Welcome/Welcome'
export * from './Launch/Launch'
export * from './OpenFailed/OpenFailed'
export * from './DataNotMoved/DataNotMoved'
export * from './ProfileInUse/ProfileInUse'
export * from './Start/Start'
export * from './Home/Home'
export * from './NewProject/NewProject'
export * from './ProjectRules/ProjectRules'
export * from './ProjectRepositories/ProjectRepositories'
export * from './Automations/Automations'
export * from './Automations/AutomationPage'
