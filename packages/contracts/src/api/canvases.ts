import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ArtifactDrawing, ArtifactsHow, ArtifactsPlace, CanvasDetail, CanvasSummary, CanvasText, RepositoryFolders } from '../canvases'
import { call, ClientAuthority, command } from './rpc'

/**
 * A project's canvases and artifacts: listing, reading and drawing them.
 * Where they're saved to a repository, and saving or not.
 */
export const CanvasesApi = RpcGroup.make(
  /** A project's canvases (ADR-104), each with its latest version, newest first; archived ones only where asked. */
  call('ListCanvases', { projectId: Schema.String, archived: Schema.optional(Schema.Boolean) }, Schema.Array(CanvasSummary)),
  /** A project's artifacts whose own chat is drawing their first version, newest first: each shows among its artifacts at once. */
  call('ListArtifactsDrawing', { projectId: Schema.String }, Schema.Array(ArtifactDrawing)),
  /** One of a project's canvases whole: its versions, and the comments sent on it. */
  call('GetCanvas', { canvasId: Schema.String }, CanvasDetail),
  /** A version's entry as the window draws it, for a document, a diagram or an SVG: its words, read from the artifact store. */
  call('ReadCanvasText', { canvasId: Schema.String, version: Schema.Number }, CanvasText),
  /** Where a project's artifacts go when saved to a repository: its place for them, or Althar's pick for the first save. */
  call('GetArtifactsPlace', { projectId: Schema.String }, ArtifactsPlace),
  /** One of a project's repositories' folders at the head of its default branch: where an artifact could be saved. */
  call('ListRepositoryFolders', { projectId: Schema.String, repositoryId: Schema.String }, RepositoryFolders),
  /** Sets the project's place for artifacts, or clears it with null: where Save to repo puts one unless someone picks elsewhere. */
  command(
    'SetArtifactsHome',
    {
      projectId: Schema.String,
      home: Schema.NullOr(Schema.Struct({ repositoryId: Schema.String, folder: Schema.String, how: ArtifactsHow, follow: Schema.Boolean })),
    },
    Schema.Void,
  ),
  /**
   * Saves a canvas's latest version to a folder of its own in one of the project's repositories (`path`, with a trailing
   * slash), in a pull request of its own or straight to the default branch, or moves it there where it was saved elsewhere.
   * It answers at once, the canvas saying it is saving; the commit follows, and the canvas says how it went. `makeHome`
   * makes the folder it is in the project's place for artifacts from now on.
   */
  command(
    'SaveCanvas',
    {
      canvasId: Schema.String,
      repositoryId: Schema.String,
      path: Schema.String,
      how: ArtifactsHow,
      follow: Schema.Boolean,
      makeHome: Schema.optional(Schema.Boolean),
    },
    Schema.Void,
  ),
  /** Stops saving a canvas to its repository: what was committed stays there, and new versions stay in Althar. */
  command('StopSavingCanvas', { canvasId: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
