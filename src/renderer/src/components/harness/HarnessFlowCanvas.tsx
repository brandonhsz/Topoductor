import React, { useCallback, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './harness-canvas.css'
import { Bot, Flag, Layers, Loader2, Play, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/i18n/use-translate'
import { describeCondition } from '../../../../shared/harness/harness-agent-prompt'
import { tuiAgentDisplayName } from '../../../../shared/agent-launch/catalog/tui-agent-display-names'
import type { HarnessFlow, HarnessNode } from '../../../../shared/harness/harness-flow-types'

export type HarnessNodeLiveStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export type HarnessCanvasSelection = { kind: 'node' | 'edge'; id: string } | null

type HarnessNodeData = {
  node: HarnessNode
  agentLabel: string | null
  status: HarnessNodeLiveStatus | null
  visits: number
}

type HarnessRfNode = Node<HarnessNodeData, 'harness'>

const KIND_ICONS = {
  start: Play,
  agent: Bot,
  human: UserRound,
  waves: Layers,
  end: Flag
} as const

const STATUS_BORDER: Record<HarnessNodeLiveStatus, string> = {
  running: 'border-primary',
  waiting: 'border-status-warning',
  done: 'border-status-success',
  failed: 'border-destructive',
  stopped: 'border-border'
}

function agentLabel(flow: HarnessFlow, node: HarnessNode): string | null {
  if (node.kind === 'agent') {
    return tuiAgentDisplayName(node.agent ?? flow.defaultAgent)
  }
  if (node.kind === 'waves') {
    return node.roles.map((role) => role.name).join(' · ')
  }
  return null
}

const HarnessFlowNode = React.memo(function HarnessFlowNode({
  data,
  selected
}: NodeProps<HarnessRfNode>): React.JSX.Element {
  const { node, status, visits } = data
  const Icon = KIND_ICONS[node.kind]
  return (
    <div
      className={cn(
        'w-56 rounded-xl border bg-card px-3 py-2 text-card-foreground shadow-xs',
        status ? STATUS_BORDER[status] : 'border-border',
        selected && 'ring-2 ring-ring'
      )}
    >
      {/* Start keeps an input: a flow may loop back to re-ask the intent. */}
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        {status === 'running' ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.title}</span>
        {visits > 1 ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-3xs text-muted-foreground">
            ×{visits}
          </span>
        ) : null}
      </div>
      {node.block || data.agentLabel ? (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {node.block ? (
            <span className="shrink-0 text-2xs font-semibold tracking-wider uppercase">
              {node.block}
            </span>
          ) : null}
          {data.agentLabel ? <span className="min-w-0 truncate">{data.agentLabel}</span> : null}
        </div>
      ) : null}
      {node.kind !== 'end' ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  )
})

const NODE_TYPES = { harness: HarnessFlowNode }

type NodeLayout = {
  measured: Map<string, HarnessRfNode['measured']>
  dragging: Map<string, HarnessFlow['nodes'][number]['position']>
}

/** Pure: returns `current` untouched when no change concerns layout. */
function nextLayout(
  current: NodeLayout,
  changes: readonly NodeChange<HarnessRfNode>[]
): NodeLayout {
  const measured = new Map(current.measured)
  const dragging = new Map(current.dragging)
  let changed = false
  for (const change of changes) {
    if (change.type === 'dimensions' && change.dimensions) {
      measured.set(change.id, change.dimensions)
      changed = true
    } else if (change.type === 'position' && change.position && change.dragging) {
      dragging.set(change.id, change.position)
      changed = true
    }
  }
  return changed ? { measured, dragging } : current
}

function toRfNodes(
  flow: HarnessFlow,
  selection: HarnessCanvasSelection,
  statuses: Record<string, HarnessNodeLiveStatus>,
  visits: Record<string, number>,
  layout: NodeLayout
): HarnessRfNode[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: 'harness',
    position: layout.dragging.get(node.id) ?? node.position,
    selected: selection?.kind === 'node' && selection.id === node.id,
    measured: layout.measured.get(node.id),
    data: {
      node,
      agentLabel: agentLabel(flow, node),
      status: statuses[node.id] ?? null,
      visits: visits[node.id] ?? 0
    }
  }))
}

type HarnessFlowCanvasProps = {
  flow: HarnessFlow
  editable: boolean
  selection: HarnessCanvasSelection
  onSelect: (selection: HarnessCanvasSelection) => void
  onFlowChange?: (flow: HarnessFlow) => void
  statuses?: Record<string, HarnessNodeLiveStatus>
  visits?: Record<string, number>
}

/** Area right of the start node that opens in view; the minimap reaches the rest. */
const FOCUS_WIDTH = 950
const FOCUS_HEIGHT = 380

/** Opens on live nodes and what fed them, else on the area around start, so big flows start readable. */
function initialFocus(
  flow: HarnessFlow,
  statuses: Record<string, HarnessNodeLiveStatus>
): { id: string }[] | undefined {
  const live = new Set(
    flow.nodes
      .filter((node) => statuses[node.id] === 'running' || statuses[node.id] === 'waiting')
      .map((node) => node.id)
  )
  if (live.size > 0) {
    const around = new Set(live)
    for (const edge of flow.edges) {
      if (live.has(edge.target)) {
        around.add(edge.source)
      }
    }
    return [...around].map((id) => ({ id }))
  }
  const start = flow.nodes.find((node) => node.kind === 'start')
  if (!start) {
    return undefined
  }
  return flow.nodes
    .filter(
      (node) =>
        node.position.x - start.position.x <= FOCUS_WIDTH &&
        node.position.x >= start.position.x - 50 &&
        Math.abs(node.position.y - start.position.y) <= FOCUS_HEIGHT
    )
    .map((node) => ({ id: node.id }))
}

const EMPTY_STATUSES: Record<string, HarnessNodeLiveStatus> = {}
const EMPTY_VISITS: Record<string, number> = {}

function CanvasInner({
  flow,
  editable,
  selection,
  onSelect,
  onFlowChange,
  statuses = EMPTY_STATUSES,
  visits = EMPTY_VISITS
}: HarnessFlowCanvasProps): React.JSX.Element {
  const t = useTranslate()
  const limitLabel = t('components.harness.limitEdge', 'At the visit limit')
  // Only what React Flow measures or a drag in progress lives here; the flow owns everything else.
  const [layout, setLayout] = useState<NodeLayout>(() => ({
    measured: new Map(),
    dragging: new Map()
  }))
  const [focus] = useState(() => initialFocus(flow, statuses))
  const nodes = useMemo(
    () => toRfNodes(flow, selection, statuses, visits, layout),
    [flow, selection, statuses, visits, layout]
  )

  const edges = useMemo<Edge[]>(
    () => [
      ...flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label:
          [edge.label, edge.when ? describeCondition(edge.when) : ''].filter(Boolean).join(' · ') ||
          undefined,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: selection?.kind === 'edge' && selection.id === edge.id,
        className:
          statuses[edge.source] === 'done' && statuses[edge.target] ? 'harness-edge-live' : ''
      })),
      // Drawn from node settings, so they are not selectable or deletable as edges.
      ...flow.nodes.flatMap((node) =>
        'limitTarget' in node && node.limitTarget
          ? [
              {
                id: `limit:${node.id}`,
                source: node.id,
                target: node.limitTarget,
                label: limitLabel,
                type: 'smoothstep',
                selectable: false,
                deletable: false,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { strokeDasharray: '4 4' }
              }
            ]
          : []
      )
    ],
    [flow.edges, flow.nodes, selection, statuses, limitLabel]
  )

  const onNodesChange = useCallback((changes: NodeChange<HarnessRfNode>[]) => {
    setLayout((current) => nextLayout(current, changes))
  }, [])

  const commit = useCallback(
    (next: Partial<HarnessFlow>) => onFlowChange?.({ ...flow, ...next }),
    [flow, onFlowChange]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return
      }
      let id = `${connection.source}--${connection.target}`
      for (let n = 2; flow.edges.some((edge) => edge.id === id); n++) {
        id = `${connection.source}--${connection.target}-${n}`
      }
      commit({
        edges: [
          ...flow.edges,
          { id, source: connection.source, target: connection.target, label: '', when: null }
        ]
      })
      onSelect({ kind: 'edge', id })
    },
    [commit, flow.edges, onSelect]
  )

  return (
    <ReactFlow<HarnessRfNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_event, _node, dragged) => {
        const moved = new Map(dragged.map((node) => [node.id, node.position]))
        setLayout((current) => ({ measured: current.measured, dragging: new Map() }))
        commit({
          nodes: flow.nodes.map((node) =>
            moved.has(node.id) ? { ...node, position: moved.get(node.id)! } : node
          )
        })
      }}
      onNodesDelete={(deleted) => {
        const ids = new Set(deleted.map((node) => node.id))
        commit({
          nodes: flow.nodes.filter((node) => !ids.has(node.id)),
          edges: flow.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
        })
        onSelect(null)
      }}
      onEdgesDelete={(deleted) => {
        const ids = new Set(deleted.map((edge) => edge.id))
        commit({ edges: flow.edges.filter((edge) => !ids.has(edge.id)) })
        onSelect(null)
      }}
      onConnect={onConnect}
      onNodeClick={(_event, node) => onSelect({ kind: 'node', id: node.id })}
      onEdgeClick={(_event, edge) => {
        if (flow.edges.some((entry) => entry.id === edge.id)) {
          onSelect({ kind: 'edge', id: edge.id })
        }
      }}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={editable}
      nodesConnectable={editable}
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 0.9, nodes: focus }}
      minZoom={0.2}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor="var(--muted-foreground)" className="hidden md:block" />
    </ReactFlow>
  )
}

export function HarnessFlowCanvas(props: HarnessFlowCanvasProps): React.JSX.Element {
  return (
    <div data-harness-canvas="" className="relative h-full min-h-0 w-full">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
