import prototype from 'virtual:prototype-workbench/prototype'

import { mount } from './mount'

/*
 * The page's script: the prototype in the folder the server was started on,
 * drawn on the workbench. An edit to its `prototype.tsx` draws the new
 * version in place, keeping the direction, the state and what was done in
 * them; an edit to a direction's own component is React's fast refresh.
 */

const draw = mount(prototype)

if (import.meta.hot)
  import.meta.hot.accept('virtual:prototype-workbench/prototype', (next) => {
    if (next !== undefined) draw(next.default as typeof prototype)
  })
