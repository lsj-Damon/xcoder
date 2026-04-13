import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS,
} from '../../constants/tools.js'
import type { Tool } from '../../Tool.js'
import { toolMatchesName } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import { isInProcessTeammate } from '../../utils/teammateContext.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../ExitPlanModeTool/constants.js'
import { AGENT_TOOL_NAME } from './constants.js'

export type AgentExecutionPolicy = {
  allowMcpTools: boolean
  allowPlanExitInPlanMode: boolean
  asyncAllowedTools: ReadonlySet<string>
  blockedForAllAgents: ReadonlySet<string>
  blockedForCustomAgents: ReadonlySet<string>
  allowNestedAgentForInProcessTeammates: boolean
  allowTaskCoordinationForInProcessTeammates: boolean
  isAsync: boolean
  isBuiltIn: boolean
  permissionMode?: PermissionMode
}

export function buildAgentExecutionPolicy(params: {
  isBuiltIn: boolean
  isAsync?: boolean
  permissionMode?: PermissionMode
}): AgentExecutionPolicy {
  const isAsync = params.isAsync ?? false
  const inProcessTeammateContext =
    isAsync && isAgentSwarmsEnabled() && isInProcessTeammate()

  return {
    allowMcpTools: true,
    allowPlanExitInPlanMode: params.permissionMode === 'plan',
    asyncAllowedTools: ASYNC_AGENT_ALLOWED_TOOLS,
    blockedForAllAgents: ALL_AGENT_DISALLOWED_TOOLS,
    blockedForCustomAgents: CUSTOM_AGENT_DISALLOWED_TOOLS,
    allowNestedAgentForInProcessTeammates: inProcessTeammateContext,
    allowTaskCoordinationForInProcessTeammates: inProcessTeammateContext,
    isAsync,
    isBuiltIn: params.isBuiltIn,
    permissionMode: params.permissionMode,
  }
}

export function isToolAllowedByAgentPolicy(
  tool: Tool,
  policy: AgentExecutionPolicy,
): boolean {
  if (policy.allowMcpTools && (tool.isMcp === true || tool.mcpInfo !== undefined)) {
    return true
  }

  if (
    policy.allowPlanExitInPlanMode &&
    toolMatchesName(tool, EXIT_PLAN_MODE_V2_TOOL_NAME)
  ) {
    return true
  }

  if (policy.blockedForAllAgents.has(tool.name)) {
    return false
  }

  if (!policy.isBuiltIn && policy.blockedForCustomAgents.has(tool.name)) {
    return false
  }

  if (!policy.isAsync) {
    return true
  }

  if (policy.asyncAllowedTools.has(tool.name)) {
    return true
  }

  if (
    policy.allowNestedAgentForInProcessTeammates &&
    toolMatchesName(tool, AGENT_TOOL_NAME)
  ) {
    return true
  }

  if (
    policy.allowTaskCoordinationForInProcessTeammates &&
    IN_PROCESS_TEAMMATE_ALLOWED_TOOLS.has(tool.name)
  ) {
    return true
  }

  return false
}
