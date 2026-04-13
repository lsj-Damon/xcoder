import type { CompressionPolicy, CompressionSignals } from './types.js'

export function buildCompressionPolicy(
  signals: CompressionSignals,
): CompressionPolicy {
  const preservationPlan = signals.preservationPlan
  return {
    applyToolResultBudget: true,
    persistReplacements: signals.isAgentQuery || signals.isMainThreadQuery,
    applySnip: signals.hasSnipModule,
    applyMicrocompact: true,
    applyContextCollapse: signals.hasContextCollapse,
    applyAutocompact: true,
    preservePlanState: preservationPlan.preservePlanState,
    preserveSkillState: preservationPlan.preserveSkillState,
    preserveAgentState: preservationPlan.preserveAgentState,
    preserveMcpState: preservationPlan.preserveMcpState,
    preferGranularCompaction: preservationPlan.preferGranularCompaction,
    requireAttachmentRebuild: preservationPlan.requireAttachmentRebuild,
  }
}
