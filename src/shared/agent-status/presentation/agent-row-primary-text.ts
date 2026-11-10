import type { AgentStatusEntry } from '../contracts/agent-status-types'
import { getRuntimePathBasename } from '../../cross-platform-path'
import {
  findTopoDispatchPreambleStart,
  findTopoDispatchTaskMarkerIndex,
  TOPO_DISPATCH_STATUS_TASK_MARKER
} from '../../topo-dispatch-status-prompt'

const TOPO_DISPATCH_TASK_MARKER = TOPO_DISPATCH_STATUS_TASK_MARKER
const TOPO_DISPATCH_TASK_ID_MARKER = 'Your task ID is:'
// Match the generated-title scan budget; previews need only the first nonempty task line.
const TOPO_DISPATCH_TASK_PREVIEW_SCAN_LIMIT = 512
const TOPO_DISPATCH_TASK_ID_SCAN_LIMIT = 1024
// Bound searches past multi-KB CLI preambles so malformed large prompts cannot force a full scan.
const TOPO_DISPATCH_TASK_MARKER_SCAN_LIMIT = 32_768
// Pi and OMP put CLI-attached files first, as `<file name="/abs/path">…</file>`, before the typed words.
const ATTACHED_FILE_LEAD = /^<file name="([^"]+)/
const ATTACHED_FILE_CLOSER = '</file>'
// Openers people don't type: a keyed object, an array of objects or strings, an XML or HTML document.
const PASTED_DATA_LEAD = /^(?:\{\s*"[^"]*"\s*:|\[\s*\{\s*"|\[\s*"[^"]*"\s*,|<\?xml\s|<!doctype\s)/i

/** True when the live prompt is still a Topo dispatch turn (not sticky metadata alone). */
export function isTopoDispatchPrompt(prompt: string): boolean {
  return findTopoDispatchPreambleStart(prompt) !== -1
}

/** Only matching live dispatch task IDs may use sticky labels; missing IDs in truncated status prompts still trust labels. */
export function orchestrationLabelsMatchLiveDispatch(
  entry: Pick<AgentStatusEntry, 'orchestration' | 'prompt'>
): boolean {
  if (!isTopoDispatchPrompt(entry.prompt)) {
    return false
  }
  const orchestrationTaskId = entry.orchestration?.taskId?.trim()
  if (!orchestrationTaskId) {
    return false
  }
  const liveTaskId = getTopoDispatchTaskId(entry.prompt)
  if (!liveTaskId) {
    return true
  }
  return liveTaskId === orchestrationTaskId
}

export function getAgentRowPrimaryText(
  entry: Pick<AgentStatusEntry, 'orchestration' | 'prompt'>
): string {
  // Prefer matching task labels, then TASK-body preview; never expose folded lifecycle boilerplate.
  if (orchestrationLabelsMatchLiveDispatch(entry)) {
    return (
      entry.orchestration?.displayName?.trim() ||
      entry.orchestration?.taskTitle?.trim() ||
      getTopoDispatchTaskPreview(entry.prompt)
    )
  }
  if (isTopoDispatchPrompt(entry.prompt)) {
    return getTopoDispatchTaskPreview(entry.prompt)
  }
  return getAgentPromptLabel(entry.prompt)
}

/** A prompt as a label: its words, else an attached file's name, else '' when it opens with pasted data. */
export function getAgentPromptLabel(prompt: string): string {
  const text = prompt.trim()
  const attachedFile = ATTACHED_FILE_LEAD.exec(text)
  if (attachedFile) {
    const closer = text.lastIndexOf(ATTACHED_FILE_CLOSER)
    const afterFiles = closer === -1 ? '' : text.slice(closer + ATTACHED_FILE_CLOSER.length)
    return getAgentPromptLabel(afterFiles) || getRuntimePathBasename(attachedFile[1])
  }
  return PASTED_DATA_LEAD.test(text) ? '' : text
}

export function getAgentRowGeneratedTitleText(
  entry: Pick<AgentStatusEntry, 'orchestration' | 'prompt'>
): string {
  // Sticky dispatch labels must not rename later work.
  if (isTopoDispatchPrompt(entry.prompt)) {
    return getAgentRowPrimaryText(entry)
  }
  return entry.prompt
}

export function getTopoDispatchTaskId(prompt: string): string | null {
  const start = findTopoDispatchPreambleStart(prompt)
  if (start === -1) {
    return null
  }
  const scan = prompt.slice(start, start + TOPO_DISPATCH_TASK_ID_SCAN_LIMIT)
  const markerIndex = scan.indexOf(TOPO_DISPATCH_TASK_ID_MARKER)
  if (markerIndex === -1) {
    return null
  }
  // Status normalization folds newlines to spaces; delimit task IDs on any whitespace.
  const afterMarker = scan.slice(markerIndex + TOPO_DISPATCH_TASK_ID_MARKER.length).trimStart()
  const idEnd = afterMarker.search(/\s/)
  const idLine = idEnd === -1 ? afterMarker : afterMarker.slice(0, idEnd)
  return idLine || null
}

function getTopoDispatchTaskPreview(prompt: string): string {
  // Render only bounded marker/preview windows; accept both raw multiline preambles and normalized 200-char single-line task bodies.
  const start = findTopoDispatchPreambleStart(prompt)
  if (start === -1) {
    return ''
  }
  const scan = prompt.slice(
    start,
    start + TOPO_DISPATCH_TASK_MARKER_SCAN_LIMIT + TOPO_DISPATCH_TASK_PREVIEW_SCAN_LIMIT
  )
  // Share standalone-marker rules so base-drift subjects cannot impersonate the real task separator.
  const taskMarkerIndex = findTopoDispatchTaskMarkerIndex(scan)
  if (taskMarkerIndex === -1) {
    return ''
  }
  const taskBodyStart = taskMarkerIndex + TOPO_DISPATCH_TASK_MARKER.length
  const taskBody = scan.slice(taskBodyStart, taskBodyStart + TOPO_DISPATCH_TASK_PREVIEW_SCAN_LIMIT)
  for (const line of taskBody.split(/\r?\n/)) {
    const preview = line.trim().replace(/\s+/g, ' ')
    if (preview) {
      return preview
    }
  }
  return ''
}
