/*
 * The kit as the app imports it, with three parts wrapped so a page's
 * direction can change what a ready card says: the board's card, its lanes
 * (for grouping Needs you) and the home's line. Each wrapper draws the kit's
 * own component; with no direction (today) it passes everything through.
 */
export * from '../../../../packages/ui/src/index'
export { BoardCard, BoardColumn, NeedLine } from './swap'
