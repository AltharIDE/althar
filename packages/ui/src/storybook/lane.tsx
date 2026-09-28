import type { Decorator } from '@storybook/react-vite'
import { BoardList } from '../board/Board/Board'

/* A card or row at a lane's width, for stories. The states grid sets its own widths. */
export const laneDecorator: Decorator = (Story, { parameters }) =>
  parameters.pseudo ? Story() : <div style={{ width: 340 }}>{Story()}</div>

/* The card's own hover, and its title button's focus and press. */
export const cardStates = { hover: 'article', focus: 'article button', pressed: 'article button' }

/* A row inside the list it belongs in, for stories. The states grid wraps each of its own. */
export const listDecorator: Decorator = (Story, { parameters }) => (parameters.pseudo ? Story() : <BoardList>{Story()}</BoardList>)
