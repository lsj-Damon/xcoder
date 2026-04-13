import type { QuerySource } from '../../../constants/querySource.js'
import type { QueryDeps } from '../../../query/deps.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { Message } from '../../../types/message.js'
import type { AutoCompactTrackingState } from '../autoCompact.js'
import type { CompactionResult } from '../compact.js'
import type { PendingCacheEdits } from '../microCompact.js'

export type SnipCompactModule = {
  snipCompactIfNeeded(messages: Message[]): {
    messages: Message[]
    tokensFreed: number
    boundaryMessage?: Message
  }
}

export type ContextCollapseModule = {
  applyCollapsesIfNeeded<T>(
    messages: T[],
    toolUseContext: unknown,
    querySource?: string,
  ): Promise<{ messages: T[] }>
}

export type CompressionPipelineInput = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: Record<string, string>
  systemContext: Record<string, string>
  querySource: QuerySource
  toolUseContext: ToolUseContext
  tracking?: AutoCompactTrackingState
  deps: QueryDeps
  snipModule?: SnipCompactModule | null
  contextCollapse?: ContextCollapseModule | null
}

export type CompressionSignals = {
  querySource: QuerySource
  isAgentQuery: boolean
  isMainThreadQuery: boolean
  hasContentReplacementState: boolean
  hasSnipModule: boolean
  hasContextCollapse: boolean
  preservationPlan: PreservationPlan
  tracking?: AutoCompactTrackingState
}

export type CompressionPolicy = {
  applyToolResultBudget: boolean
  persistReplacements: boolean
  applySnip: boolean
  applyMicrocompact: boolean
  applyContextCollapse: boolean
  applyAutocompact: boolean
  preservePlanState: boolean
  preserveSkillState: boolean
  preserveAgentState: boolean
  preserveMcpState: boolean
  preferGranularCompaction: boolean
  requireAttachmentRebuild: boolean
}

export type PreservationPriority = 'critical' | 'high' | 'medium'

export type PreservationArtifactKind =
  | 'plan_file'
  | 'plan_mode'
  | 'invoked_skills'
  | 'agent_listing_delta'
  | 'mcp_instructions_delta'

export type PreservationArtifact = {
  kind: PreservationArtifactKind
  priority: PreservationPriority
  present: boolean
  details?: string
}

export type PreservationPlan = {
  artifacts: PreservationArtifact[]
  hasCriticalArtifacts: boolean
  hasHighPriorityArtifacts: boolean
  preservePlanState: boolean
  preserveSkillState: boolean
  preserveAgentState: boolean
  preserveMcpState: boolean
  requireAttachmentRebuild: boolean
  preferGranularCompaction: boolean
}

export type CompressionPipelineResult = {
  messages: Message[]
  tracking?: AutoCompactTrackingState
  compactionResult?: CompactionResult
  preCompactMessages?: Message[]
  preservationPlan: PreservationPlan
  pendingCacheEdits?: PendingCacheEdits
  snipTokensFreed: number
}
