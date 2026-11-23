/*
 * The kit as the lab hands it to the app: all of it, as it is, but for the
 * few components a direction speaks through, each the kit's own wrapped
 * (wrapped.tsx). An explicit export wins over `export *`.
 */
export * from '../../../../packages/ui/src/index.ts'
export { Behind, BoardColumn, NextLine, NextRow, TaskHeader } from './wrapped'
