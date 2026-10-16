// Scrappy: what the prototype reaches for itself, as the desktop app has it (the kit doesn't depend on these).
export { useQuery, useQueryClient } from '../../../../apps/desktop/node_modules/@tanstack/react-query'
export {
  createBrowserHistory,
  RouterProvider,
  useNavigate,
  useRouterState,
} from '../../../../apps/desktop/node_modules/@tanstack/react-router'
export type {
  BoardTask,
  ConnectionList,
  ConnectionSummary,
  HomeTask,
  Product,
  ProjectNote,
  ProjectRepository,
  ProjectRulesView,
  ProjectSummary,
  Runnable,
} from '../../../contracts/src/index'
