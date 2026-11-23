import type { Meta, StoryObj } from '@storybook/react-vite'

import { AlertToTask } from './Alert'
import { ClusterPanel } from './Cluster'
import { GateCard } from './Gate'
import { DevOpsHome } from './Home'
import { Stage } from './parts'
import { ProfileOffer, ProfileSettings } from './Profile'
import { RunLog } from './Run'

/*
 * The DevOps lens, in depth (README.md): the home, the cluster panel, the
 * prod gate and its staging and dev variants, a run in the run log, an alert
 * becoming a task, and the Ops profile. Made-up data, from the kit's pieces.
 * Light and dark from the toolbar. A prototype: nothing in the kit uses it.
 */

const meta = {
  title: 'Workbench/DevOps lens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** 1 · infra's home under the DevOps lens: environments and locks, what waits on DevOps, alerts, the cluster, deploys. */
export const Home: Story = { render: () => <DevOpsHome /> }

/** 2 · The cluster health panel on prod, refund-webhook opened. Allowlisted fields only (ADR-112). */
export const ClusterHealth: Story = {
  render: () => (
    <Stage width={1080}>
      <ClusterPanel />
    </Stage>
  ),
}

/** 3 · The prod gate: an Ops task asks to apply on prod. Approve or Refuse. */
export const ProdGate: Story = {
  render: () => (
    <Stage width={640}>
      <GateCard mode="prod" />
    </Stage>
  ),
}

/** 3 · The prod gate while someone else holds prod's lock: approving queues the run after it. */
export const ProdGateLocked: Story = {
  render: () => (
    <Stage width={640}>
      <GateCard mode="prod" locked />
    </Stage>
  ),
}

/** 3 · The same card for a Terraform plan, and for an Ansible check run on hosts. */
export const ProdGateTerraformAndAnsible: Story = {
  render: () => (
    <Stage width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GateCard mode="prod" kind="terraform" />
        <GateCard mode="prod" kind="ansible" />
      </div>
    </Stage>
  ),
}

/** 3 · Staging, decided by the coordinator, and dev, which just ran. */
export const StagingAndDev: Story = {
  render: () => (
    <Stage width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GateCard mode="staging" />
        <GateCard mode="dev" />
      </div>
    </Stage>
  ),
}

/** 4 · The approved apply, live in the run log: it prints, and Stop stops it. Left alone it finishes by itself. */
export const RunLive: Story = {
  render: () => (
    <Stage width={860}>
      <RunLog phase="live" />
    </Stage>
  ),
}

/** 4 · Stopped by the person mid-rollout. */
export const RunStopped: Story = {
  render: () => (
    <Stage width={860}>
      <RunLog phase="stopped" />
    </Stage>
  ),
}

/** 4 · Finished: exit code, commit and target, ending "ran, with this result", with no pull request. */
export const RunFinished: Story = {
  render: () => (
    <Stage width={860}>
      <RunLog phase="finished" />
    </Stage>
  ),
}

/** 5 · A firing alert. Investigate drafts an incident task. */
export const Alert: Story = {
  render: () => (
    <Stage width={640}>
      <AlertToTask />
    </Stage>
  ),
}

/** 5 · After Investigate: the incident task, drafted, with the cluster panel's facts attached. */
export const AlertDrafted: Story = {
  render: () => (
    <Stage width={640}>
      <AlertToTask drafted />
    </Stage>
  ),
}

/** 6 · The coordinator offers the Ops profile on an infra repository. */
export const OpsProfileOffer: Story = {
  render: () => (
    <Stage width={640}>
      <ProfileOffer />
    </Stage>
  ),
}

/** 6 · The Ops profile's settings: SSH agent yes, key files never, secrets per run, and who decides each environment. */
export const OpsProfileSettings: Story = {
  render: () => (
    <Stage width={640}>
      <ProfileSettings />
    </Stage>
  ),
}
