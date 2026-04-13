import { getInvokedSkillsForAgent } from '../../../bootstrap/state.js'
import type { ToolUseContext } from '../../../Tool.js'
import { getPlan } from '../../../utils/plans.js'
import type {
  PreservationArtifact,
  PreservationPlan,
} from './types.js'

function buildArtifact(
  kind: PreservationArtifact['kind'],
  priority: PreservationArtifact['priority'],
  present: boolean,
  details?: string,
): PreservationArtifact {
  return { kind, priority, present, details }
}

export function buildPreservationPlan(
  toolUseContext: ToolUseContext,
): PreservationPlan {
  const planContent = getPlan(toolUseContext.agentId)
  const invokedSkills = getInvokedSkillsForAgent(toolUseContext.agentId)
  const planModeActive =
    toolUseContext.getAppState().toolPermissionContext.mode === 'plan'
  const hasAgentListings =
    toolUseContext.options.agentDefinitions.activeAgents.length > 0
  const hasMcpInstructions = toolUseContext.options.mcpClients.length > 0

  const artifacts: PreservationArtifact[] = [
    buildArtifact(
      'plan_file',
      'critical',
      Boolean(planContent),
      planContent
        ? 'plan file content available for current agent/session'
        : undefined,
    ),
    buildArtifact(
      'plan_mode',
      'critical',
      planModeActive,
      planModeActive ? 'tool permission mode is currently plan' : undefined,
    ),
    buildArtifact(
      'invoked_skills',
      'high',
      invokedSkills.size > 0,
      invokedSkills.size > 0
        ? `${String(invokedSkills.size)} invoked skill(s) tracked for preservation`
        : undefined,
    ),
    buildArtifact(
      'agent_listing_delta',
      'medium',
      hasAgentListings,
      hasAgentListings
        ? `${String(toolUseContext.options.agentDefinitions.activeAgents.length)} active agent definition(s)`
        : undefined,
    ),
    buildArtifact(
      'mcp_instructions_delta',
      'medium',
      hasMcpInstructions,
      hasMcpInstructions
        ? `${String(toolUseContext.options.mcpClients.length)} MCP client(s) available`
        : undefined,
    ),
  ]

  const hasCriticalArtifacts = artifacts.some(
    artifact => artifact.present && artifact.priority === 'critical',
  )
  const hasHighPriorityArtifacts = artifacts.some(
    artifact =>
      artifact.present &&
      (artifact.priority === 'critical' || artifact.priority === 'high'),
  )

  const preservePlanState = artifacts.some(
    artifact =>
      artifact.present &&
      (artifact.kind === 'plan_file' || artifact.kind === 'plan_mode'),
  )
  const preserveSkillState = artifacts.some(
    artifact => artifact.present && artifact.kind === 'invoked_skills',
  )
  const preserveAgentState = artifacts.some(
    artifact => artifact.present && artifact.kind === 'agent_listing_delta',
  )
  const preserveMcpState = artifacts.some(
    artifact => artifact.present && artifact.kind === 'mcp_instructions_delta',
  )

  return {
    artifacts,
    hasCriticalArtifacts,
    hasHighPriorityArtifacts,
    preservePlanState,
    preserveSkillState,
    preserveAgentState,
    preserveMcpState,
    requireAttachmentRebuild:
      preservePlanState ||
      preserveSkillState ||
      preserveAgentState ||
      preserveMcpState,
    preferGranularCompaction: hasHighPriorityArtifacts,
  }
}
