import type { ApiRequest } from './api'

/** Linear's public GraphQL contracts, checked against @linear/sdk 102.0.0. Variables carry all user text. */
export const LINEAR_RESOURCES = {
  document: {
    list: 'documents',
    type: 'Document',
    fields: 'id title content url updatedAt',
    create: 'DocumentCreateInput',
    update: 'DocumentUpdateInput',
    result: 'document',
  },
  project: {
    list: 'projects',
    type: 'Project',
    fields: 'id name description content url targetDate status { id name }',
    create: 'ProjectCreateInput',
    update: 'ProjectUpdateInput',
    result: 'project',
  },
  milestone: {
    list: 'projectMilestones',
    type: 'ProjectMilestone',
    fields: 'id name description targetDate project { id name }',
    create: 'ProjectMilestoneCreateInput',
    update: 'ProjectMilestoneUpdateInput',
    result: 'projectMilestone',
  },
  initiative: {
    list: 'initiatives',
    type: 'Initiative',
    fields: 'id name description content url status targetDate',
    create: 'InitiativeCreateInput',
    update: 'InitiativeUpdateInput',
    result: 'initiative',
  },
  project_update: {
    list: 'projectUpdates',
    type: 'ProjectUpdate',
    fields: 'id body url health createdAt project { id name }',
    create: 'ProjectUpdateCreateInput',
    update: 'ProjectUpdateUpdateInput',
    result: 'projectUpdate',
  },
  initiative_update: {
    list: 'initiativeUpdates',
    type: 'InitiativeUpdate',
    fields: 'id body url health createdAt initiative { id name }',
    create: 'InitiativeUpdateCreateInput',
    update: 'InitiativeUpdateUpdateInput',
    result: 'initiativeUpdate',
  },
} as const

export type LinearResource = keyof typeof LINEAR_RESOURCES

export const linearResourceRequest = (
  entity: LinearResource,
  action: 'list' | 'read' | 'save',
  options: {
    readonly id?: string
    readonly cursor?: string
    readonly limit?: number
    readonly filter?: Readonly<Record<string, unknown>>
    readonly data?: Readonly<Record<string, unknown>>
  },
): ApiRequest => {
  const spec = LINEAR_RESOURCES[entity]
  const root = spec.result
  if (action === 'read')
    return { query: `query($id: String!) { result: ${root}(id: $id) { ${spec.fields} } }`, variables: { id: options.id } }
  if (action === 'list')
    return {
      query: `query($first: Int!, $after: String, $filter: ${spec.type}Filter) { result: ${spec.list}(first: $first, after: $after, filter: $filter) { nodes { ${spec.fields} } pageInfo { hasNextPage endCursor } } }`,
      variables: { first: options.limit ?? 50, after: options.cursor ?? null, filter: options.filter ?? {} },
    }
  const updating = options.id !== undefined
  return {
    query: `mutation(${updating ? '$id: String!, ' : ''}$input: ${updating ? spec.update : spec.create}!) { result: ${root}${updating ? 'Update' : 'Create'}(${updating ? 'id: $id, ' : ''}input: $input) { success ${root} { ${spec.fields} } } }`,
    variables: { ...(updating ? { id: options.id } : {}), input: options.data ?? {} },
  }
}

export const linearRelationsRequest = (issue: string, direction: 'outgoing' | 'incoming', cursor?: string): ApiRequest => ({
  query: `query($id: String!, $after: String) { issue(id: $id) { result: ${direction === 'incoming' ? 'inverseRelations' : 'relations'}(first: 100, after: $after) { nodes { id type issue { id identifier title state { name } } relatedIssue { id identifier title state { name } } } pageInfo { hasNextPage endCursor } } } }`,
  variables: { id: issue, after: cursor ?? null },
})

export const linearRelationChange = (
  issue: string,
  related: string,
  type: 'blocks' | 'blocked_by' | 'related' | 'duplicate',
  removeId?: string,
): ApiRequest =>
  removeId === undefined
    ? {
        query:
          'mutation($input: IssueRelationCreateInput!) { result: issueRelationCreate(input: $input) { success issueRelation { id type issue { identifier } relatedIssue { identifier } } } }',
        variables: {
          input: {
            issueId: type === 'blocked_by' ? related : issue,
            relatedIssueId: type === 'blocked_by' ? issue : related,
            type: type === 'blocked_by' ? 'blocks' : type,
          },
        },
      }
    : { query: 'mutation($id: String!) { result: issueRelationDelete(id: $id) { success } }', variables: { id: removeId } }
