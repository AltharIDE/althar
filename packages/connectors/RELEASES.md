# Releasing on each code host

What each host lets Althar do around a release (ADR-081, "A release"), as the adapters in `src/*Releases.ts` do it, and the host docs they rely on. The coordinator's tools over them are in `packages/runtime/src/coordinatorReleases.ts`. Everything here is tested against each host's fake (`tests/contract.ts`'s release clauses) and against recorded answers (`tests/releases.test.ts`). None of it has run against a real repository yet.

| | Tags | Release | Approving a run | Failed jobs again |
|---|---|---|---|---|
| GitHub | made, and moved where asked | drafted by the repository's run, published by turning the draft off | an environment's required reviewers, where the account is one | the run's failed jobs |
| GitLab | made; moving is deleting and making again | no drafts: making it is publishing it | a blocked deployment's approval (Premium), or playing a manual job | the pipeline's failed jobs |
| Bitbucket Cloud | made; moving is deleting and making again | none: publishing puts the files in Downloads | none by API: a manual step is the person's, linked | the whole pipeline, on the same commit |
| Bitbucket Data Center | made; moving is deleting and making again | none: the tag is the release | none: builds are another service's (Jenkins, Bamboo), linked | none: another service's, linked |

Where Althar can't do something, it does nothing and says so, with the host's own page for the person's press. It never does something that only looks done.

## GitHub

- Tags are refs made through the Git database: <https://docs.github.com/en/rest/git/refs>
- Releases are read by tag. A draft is published by an update with `draft: false`: <https://docs.github.com/en/rest/releases/releases>
- Runs come from Actions' workflow runs. What a run waits on is its pending deployments, each with `current_user_can_approve`. They are approved by reviewing them, and failed jobs are run again with `rerun-failed-jobs`: <https://docs.github.com/en/rest/actions/workflow-runs>
- **Prevent self-review:** an environment that has it on won't let the person approve a run their own tag started. The tool says so and links the run.

## GitLab

- Tags: <https://docs.gitlab.com/api/tags/>
- Releases: <https://docs.gitlab.com/api/releases/>
- Pipelines are read by `ref`, and retrying one runs its failed jobs again: <https://docs.gitlab.com/api/pipelines/>
- Jobs: a manual job is played: <https://docs.gitlab.com/api/jobs/>
- Deployments: a blocked one is approved (Premium and up): <https://docs.gitlab.com/api/deployments/#approve-or-reject-a-blocked-deployment>

## Bitbucket Cloud

- Tags: <https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/>
- Downloads: <https://developer.atlassian.com/cloud/bitbucket/rest/api-group-downloads/>. A file that is there already isn't put there again. Bitbucket has no API for a pipeline's built files, so the files come from the project's repository on this computer, each under 512 MiB.
- Pipelines and their steps: <https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/>. A manual step can't be run by API.

## Bitbucket Data Center

- Tags are read through the repository API: <https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-repository/#api-api-latest-projects-projectkey-repos-repositoryslug-tags-name-get>
- Tags are made and deleted through the git API: <https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-git/>
- A run is a build status another service reported on the tag's commit: <https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-builds-and-deployments/>

## Not yet confirmed against a live host

These come from the docs and haven't been tried on a real repository:

- **GitHub** lists a tag's runs with `branch=<tag>` (`githubReleases.ts`). The docs say `branch` filters by the run's `head_branch`, and a tag push's run gives the tag there.
- **Bitbucket Cloud** filters pipelines by `target.ref_name`, and a pipeline paused on a manual step is read as `PAUSED` or `HALTED`, or as `IN_PROGRESS` with the stage `PAUSED` (`bitbucketCloudReleases.ts`).
- **GitLab** doesn't say ahead of time whether the account may approve a deployment: one it may not is refused when approving (401 or 403, or a 400 for a deployment), and Althar passes that on with the deployment's page.

Release 0.7.0 through these tools only after one try on a scratch repository of each host it will use.
