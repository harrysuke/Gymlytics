import { compareHlc } from './hlc';
import type { ApplyOutcome, PullChange, StoredVersion } from './types';

/**
 * Conflict policy by entity class:
 *
 *  attendance_log / retail_transaction / waiver
 *     Append-only facts. Two different mutation ids for the same entity id
 *     are duplicates, not conflicts — the server's idempotency ledger picks
 *     the canonical row and both kiosks converge on it.
 *
 *  booking / dropin_user
 *     Mutable state. Last-Writer-Wins by HLC (with device id tie-break).
 *     If the losing change was still pending locally we surface a conflict
 *     card in the admin UI instead of silently dropping a check-in.
 */
export function resolveRemoteChange(
  local: StoredVersion | null,
  remote: Pick<PullChange, 'hlc' | 'version' | 'entityId'>,
): ApplyOutcome {
  if (!local) return 'applied';
  if (local.hlc === remote.hlc && local.version === remote.version) return 'duplicate';

  const comparison = compareHlc(remote.hlc, local.hlc);
  if (comparison > 0) return 'applied';
  if (comparison < 0) return 'duplicate';

  // Same HLC, different version: deterministic tie-break on entity id already
  // equal, so prefer the higher server version to guarantee convergence.
  return remote.version > local.version ? 'applied' : 'duplicate';
}

export function shouldFlagConflict(
  entity: string,
  outcome: ApplyOutcome,
  localPendingMutation: boolean,
): boolean {
  return outcome === 'duplicate' && localPendingMutation && !isAppendOnly(entity);
}

function isAppendOnly(entity: string): boolean {
  return ['attendance_log', 'retail_transaction', 'waiver'].includes(entity);
}
