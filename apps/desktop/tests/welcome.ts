import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/*
 * Walking the welcome as the person would, for tests of what comes after
 * it: the tour seen on this computer before, so it starts at the agents;
 * past the agents to the first project; and past the code host and the
 * tracker, opening the project.
 */

/** The tour was seen on this computer before: the first screen starts at the agents. */
export const seenTheTour = () => window.localStorage.setItem('althar.toured', '1')

/** Past the agents, to the first project's step. */
export const toTheProject = async () => userEvent.click(await screen.findByRole('button', { name: /^Continue/ }))

/** Past the code host and the tracker, opening the project made. */
export const openTheProject = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^(Not now|Continue)$/ }))
  await userEvent.click(await screen.findByRole('button', { name: /^Open / }))
}
