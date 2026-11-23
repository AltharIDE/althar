import { DiffLineKind } from '../../src'
import type { DiffLine } from '../../src'

/*
 * Made-up data for the DevOps lens prototype: the team's infra repository,
 * its three environments and the cluster behind them. Nothing here is read
 * from anywhere.
 */

export type Env = 'dev' | 'staging' | 'prod'
export type Tone = 'quiet' | 'ok' | 'warm' | 'danger' | 'live'

export interface Environment {
  env: Env
  name: string
  context: string
  /** What runs there now. */
  commit: string
  deployed: string
  /** Who decides an apply there (ADR-111's gate). */
  gate: string
  lock: { by: string; for: string; since: string } | null
  health: { tone: Tone; says: string }
}

export const ENVIRONMENTS: readonly Environment[] = [
  {
    env: 'dev',
    name: 'dev',
    context: 'dev-eu1',
    commit: 'c41e9a2',
    deployed: '6m ago',
    gate: 'Runs on its own',
    lock: null,
    health: { tone: 'ok', says: 'Healthy' },
  },
  {
    env: 'staging',
    name: 'staging',
    context: 'staging-eu1',
    commit: 'c41e9a2',
    deployed: 'Deploying',
    gate: 'The coordinator decides',
    lock: { by: 'Saved carts rollout', for: 'helm upgrade storefront', since: '3m' },
    health: { tone: 'live', says: 'Rolling out' },
  },
  {
    env: 'prod',
    name: 'prod',
    context: 'prod-eu1',
    commit: '8b07d13',
    deployed: '2 days ago',
    gate: 'You approve',
    lock: { by: 'Balázs', for: 'Postgres minor upgrade window', since: '41m' },
    health: { tone: 'danger', says: '2 pods failing' },
  },
]

/* ---- Cluster (ADR-112: allowlisted fields only) ------------------------- */

export interface Node {
  name: string
  ready: boolean
  cpu: number
  memory: number
  pods: string
  version: string
  pressure?: string
}

export const NODES: readonly Node[] = [
  { name: 'prod-eu1-a-7kq2', ready: true, cpu: 0.62, memory: 0.71, pods: '28 / 110', version: 'v1.31.4' },
  { name: 'prod-eu1-a-m91x', ready: true, cpu: 0.48, memory: 0.66, pods: '24 / 110', version: 'v1.31.4' },
  { name: 'prod-eu1-b-2hd8', ready: true, cpu: 0.55, memory: 0.89, pods: '31 / 110', version: 'v1.31.4', pressure: 'Memory high' },
  { name: 'prod-eu1-b-x0pl', ready: true, cpu: 0.37, memory: 0.52, pods: '19 / 110', version: 'v1.31.4' },
  { name: 'prod-eu1-c-q4vn', ready: true, cpu: 0.41, memory: 0.58, pods: '22 / 110', version: 'v1.31.4' },
  { name: 'prod-eu1-c-9tzs', ready: true, cpu: 0.29, memory: 0.44, pods: '17 / 110', version: 'v1.31.4' },
]

export interface Workload {
  namespace: string
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name: string
  ready: number
  desired: number
  rollout: { tone: Tone; says: string }
  restarts: number
  image: string
}

export const WORKLOADS: readonly Workload[] = [
  {
    namespace: 'payments',
    kind: 'Deployment',
    name: 'refund-webhook',
    ready: 1,
    desired: 3,
    rollout: { tone: 'danger', says: 'Progress deadline exceeded' },
    restarts: 14,
    image: 'refund-webhook:2.14.0',
  },
  {
    namespace: 'storefront',
    kind: 'Deployment',
    name: 'storefront-web',
    ready: 6,
    desired: 6,
    rollout: { tone: 'ok', says: 'Complete' },
    restarts: 0,
    image: 'storefront-web:8b07d13',
  },
  {
    namespace: 'storefront',
    kind: 'Deployment',
    name: 'cart-api',
    ready: 4,
    desired: 4,
    rollout: { tone: 'ok', says: 'Complete' },
    restarts: 1,
    image: 'cart-api:8b07d13',
  },
  {
    namespace: 'data',
    kind: 'StatefulSet',
    name: 'postgres',
    ready: 3,
    desired: 3,
    rollout: { tone: 'warm', says: 'Paused by Balázs' },
    restarts: 0,
    image: 'postgres:16.4',
  },
  {
    namespace: 'observability',
    kind: 'DaemonSet',
    name: 'node-exporter',
    ready: 6,
    desired: 6,
    rollout: { tone: 'ok', says: 'Complete' },
    restarts: 0,
    image: 'node-exporter:1.8.2',
  },
]

export interface Pod {
  name: string
  node: string
  ready: string
  phase: { tone: Tone; says: string }
  restarts: number
  last?: string
  age: string
}

export const PODS: readonly Pod[] = [
  {
    name: 'refund-webhook-6f9c7d-2xk4p',
    node: 'prod-eu1-b-2hd8',
    ready: '0/1',
    phase: { tone: 'danger', says: 'CrashLoopBackOff' },
    restarts: 8,
    last: 'OOMKilled, exit 137, 2m ago',
    age: '47m',
  },
  {
    name: 'refund-webhook-6f9c7d-r8m2c',
    node: 'prod-eu1-a-7kq2',
    ready: '0/1',
    phase: { tone: 'danger', says: 'CrashLoopBackOff' },
    restarts: 6,
    last: 'OOMKilled, exit 137, 4m ago',
    age: '47m',
  },
  {
    name: 'refund-webhook-5b2a1e-tq9wd',
    node: 'prod-eu1-c-q4vn',
    ready: '1/1',
    phase: { tone: 'ok', says: 'Running' },
    restarts: 0,
    age: '2d',
  },
]

export const EVENTS: ReadonlyArray<{ tone: Tone; reason: string; says: string; count: number; ago: string }> = [
  { tone: 'danger', reason: 'BackOff', says: 'Back-off restarting failed container refund-webhook', count: 31, ago: '1m' },
  { tone: 'danger', reason: 'OOMKilling', says: 'Memory limit 256Mi reached on prod-eu1-b-2hd8', count: 8, ago: '2m' },
  {
    tone: 'warm',
    reason: 'ProgressDeadlineExceeded',
    says: 'ReplicaSet refund-webhook-6f9c7d has timed out progressing',
    count: 1,
    ago: '32m',
  },
  { tone: 'quiet', reason: 'ScalingReplicaSet', says: 'Scaled up replica set refund-webhook-6f9c7d to 2', count: 1, ago: '47m' },
]

/** What the panel reads, and what it never does (ADR-112). */
export const READS = ['Deployments, StatefulSets, DaemonSets', 'Pods: status and restarts', 'Events', 'Nodes: capacity and conditions']
export const NEVER = ['Secrets', 'ConfigMaps', 'Environment values', 'Pod logs, unless a run asks']

/* ---- Alerts (Prometheus via Alertmanager) -------------------------------- */

export interface Alert {
  id: string
  name: string
  severity: 'critical' | 'warning'
  env: Env
  summary: string
  labels: string
  since: string
  value: string
}

export const ALERTS: readonly Alert[] = [
  {
    id: 'a1',
    name: 'KubePodCrashLooping',
    severity: 'critical',
    env: 'prod',
    summary: 'refund-webhook is restarting over and over',
    labels: 'namespace=payments  deployment=refund-webhook',
    since: '14m',
    value: '8 restarts in 15m',
  },
  {
    id: 'a2',
    name: 'HighMemoryPressure',
    severity: 'warning',
    env: 'prod',
    summary: 'prod-eu1-b-2hd8 above 85% memory',
    labels: 'node=prod-eu1-b-2hd8',
    since: '22m',
    value: '89%',
  },
  {
    id: 'a3',
    name: 'CertificateExpiresSoon',
    severity: 'warning',
    env: 'staging',
    summary: 'api.staging.storefront.dev expires in 9 days',
    labels: 'host=api.staging.storefront.dev',
    since: '3h',
    value: '9 days',
  },
]

/* ---- Deploys -------------------------------------------------------------- */

export interface Deploy {
  title: string
  env: Env
  commit: string
  by: string
  state: { tone: Tone; says: string }
  at: string
}

export const DEPLOYS: readonly Deploy[] = [
  {
    title: 'Saved carts behind saved_carts',
    env: 'staging',
    commit: 'c41e9a2',
    by: 'Saved carts rollout',
    state: { tone: 'live', says: 'Rolling out · 2 of 4' },
    at: '3m',
  },
  {
    title: 'Saved carts behind saved_carts',
    env: 'dev',
    commit: 'c41e9a2',
    by: 'Saved carts rollout',
    state: { tone: 'ok', says: 'Ran · exit 0' },
    at: '6m',
  },
  {
    title: 'Raise refund-webhook memory',
    env: 'dev',
    commit: 'e2d0b51',
    by: 'Refund webhook OOM',
    state: { tone: 'ok', says: 'Ran · exit 0' },
    at: '18m',
  },
  { title: 'Ingress timeouts to 60s', env: 'prod', commit: '8b07d13', by: 'Ana', state: { tone: 'ok', says: 'Ran · exit 0' }, at: '2d' },
  {
    title: 'Terraform: second NAT gateway',
    env: 'staging',
    commit: '1f3aa90',
    by: 'Network redundancy',
    state: { tone: 'danger', says: 'Refused by Balázs' },
    at: '3d',
  },
]

/* ---- Handoffs waiting on DevOps (Build → Ship) -------------------------- */

export const HANDOFFS = [
  { feature: 'Saved carts', facts: '#412, #415 and #418 merged · main green', plan: 'specs/saved-carts/ops.md', ago: '51m' },
  { feature: 'Refund webhooks', facts: '#421 merged · needs a new queue', plan: 'specs/refund-webhooks/ops.md', ago: '2h' },
]

/* ---- The gate (DEV-284) -------------------------------------------------- */

export type GateKind = 'kubectl' | 'terraform' | 'ansible'

export interface Gate {
  kind: GateKind
  task: string
  title: string
  env: Env
  command: string
  target: ReadonlyArray<readonly [string, string]>
  commit: string
  branch: string
  summary: string
  path: string
  diff: readonly DiffLine[]
}

const k = DiffLineKind

export const GATES: Record<GateKind, Gate> = {
  kubectl: {
    kind: 'kubectl',
    task: 'Refund webhook OOM',
    title: 'Raise refund-webhook memory and replicas',
    env: 'prod',
    command: 'kubectl apply --context prod-eu1 -k deploy/overlays/prod',
    target: [
      ['Context', 'prod-eu1'],
      ['Namespace', 'payments'],
      ['Objects', 'Deployment/refund-webhook'],
    ],
    commit: 'e2d0b51',
    branch: 'main',
    summary: 'kubectl diff: 1 object changes',
    path: 'deployment.yaml',
    diff: [
      { kind: k.Hunk, text: '@@ Deployment/payments/refund-webhook @@' },
      { kind: k.Context, old: 8, new: 8, text: 'spec:' },
      { kind: k.Removed, old: 9, text: '  replicas: 3' },
      { kind: k.Added, new: 9, text: '  replicas: 4' },
      { kind: k.Context, old: 10, new: 10, text: '  template:' },
      { kind: k.Context, old: 22, new: 22, text: '          resources:' },
      { kind: k.Context, old: 23, new: 23, text: '            limits:' },
      { kind: k.Removed, old: 24, text: '              memory: 256Mi' },
      { kind: k.Added, new: 24, text: '              memory: 512Mi' },
      { kind: k.Context, old: 25, new: 25, text: '            requests:' },
      { kind: k.Removed, old: 26, text: '              memory: 192Mi' },
      { kind: k.Added, new: 26, text: '              memory: 384Mi' },
    ],
  },
  terraform: {
    kind: 'terraform',
    task: 'Refund webhook queue',
    title: 'Add the refund-events queue',
    env: 'prod',
    command: 'terraform apply -input=false prod.tfplan',
    target: [
      ['Workspace', 'prod'],
      ['Account', 'storefront-prod (eu-central-1)'],
      ['Plan', '1 to add, 1 to change, 0 to destroy'],
    ],
    commit: '5c19e07',
    branch: 'main',
    summary: 'terraform plan: 1 to add, 1 to change, 0 to destroy',
    path: 'prod.tfplan',
    diff: [
      { kind: k.Hunk, text: '# aws_sqs_queue.refund_events will be created' },
      { kind: k.Added, new: 1, text: '+ resource "aws_sqs_queue" "refund_events" {' },
      { kind: k.Added, new: 2, text: '+     name                       = "refund-events-prod"' },
      { kind: k.Added, new: 3, text: '+     visibility_timeout_seconds = 60' },
      { kind: k.Added, new: 4, text: '+   }' },
      { kind: k.Hunk, text: '# aws_iam_policy.refund_webhook will be updated in-place' },
      { kind: k.Context, old: 1, new: 5, text: '  ~ policy = jsonencode({' },
      { kind: k.Added, new: 6, text: '+       Resource = "arn:aws:sqs:eu-central-1:…:refund-events-prod"' },
      { kind: k.Context, old: 2, new: 7, text: '    })' },
    ],
  },
  ansible: {
    kind: 'ansible',
    task: 'Bastion hardening',
    title: 'Turn off password logins on the bastions',
    env: 'prod',
    command: 'ansible-playbook -i inventory/prod site.yml --limit bastion',
    target: [
      ['Inventory', 'inventory/prod'],
      ['Hosts', 'bastion-eu1-a, bastion-eu1-b'],
      ['Check run', '2 changed, 0 failed'],
    ],
    commit: '77a3c2f',
    branch: 'main',
    summary: 'ansible --check --diff: 2 hosts change',
    path: 'sshd_config',
    diff: [
      { kind: k.Hunk, text: '--- before: /etc/ssh/sshd_config' },
      { kind: k.Context, old: 56, new: 56, text: '# To disable tunneled clear text passwords' },
      { kind: k.Removed, old: 57, text: 'PasswordAuthentication yes' },
      { kind: k.Added, new: 57, text: 'PasswordAuthentication no' },
      { kind: k.Context, old: 58, new: 58, text: 'PermitEmptyPasswords no' },
    ],
  },
}

/* ---- A run in the run log ----------------------------------------------- */

export const RUN_LINES = [
  'deployment.apps/refund-webhook configured',
  'Waiting for deployment "refund-webhook" rollout to finish: 1 of 4 updated replicas are available...',
  'Waiting for deployment "refund-webhook" rollout to finish: 2 of 4 updated replicas are available...',
  'Waiting for deployment "refund-webhook" rollout to finish: 3 of 4 updated replicas are available...',
]
export const RUN_DONE = [...RUN_LINES, 'deployment "refund-webhook" successfully rolled out']

export const PAST_RUNS = [
  {
    title: 'Raise refund-webhook memory',
    env: 'dev' as Env,
    command: 'kubectl apply --context dev-eu1 -k deploy/overlays/dev',
    tone: 'ok' as Tone,
    says: 'exit 0',
    at: '18m',
  },
  {
    title: 'Saved carts behind saved_carts',
    env: 'staging' as Env,
    command: 'helm upgrade storefront charts/storefront -f values/staging.yaml',
    tone: 'live' as Tone,
    says: 'Running',
    at: '3m',
  },
  {
    title: 'Ingress timeouts to 60s',
    env: 'prod' as Env,
    command: 'kubectl apply --context prod-eu1 -k deploy/overlays/prod',
    tone: 'ok' as Tone,
    says: 'exit 0',
    at: '2d',
  },
  {
    title: 'Rotate node pool',
    env: 'staging' as Env,
    command: 'terraform apply staging.tfplan',
    tone: 'danger' as Tone,
    says: 'exit 1',
    at: '4d',
  },
]
