import type { CompressionPipelineInput, CompressionSignals } from './types.js'
import { buildPreservationPlan } from './preservation.js'

export function deriveCompressionSignals(
  input: CompressionPipelineInput,
): CompressionSignals {
  const preservationPlan = buildPreservationPlan(input.toolUseContext)
  return {
    querySource: input.querySource,
    isAgentQuery: input.querySource.startsWith('agent:'),
    isMainThreadQuery: input.querySource.startsWith('repl_main_thread'),
    hasContentReplacementState: Boolean(
      input.toolUseContext.contentReplacementState,
    ),
    hasSnipModule: Boolean(input.snipModule),
    hasContextCollapse: Boolean(input.contextCollapse),
    preservationPlan,
    tracking: input.tracking,
  }
}
