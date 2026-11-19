import { HybridLogicalClock } from '@gymlytics/sync';

/**
 * One clock per API process. Every mutation that can reach a kiosk takes a
 * tick, so pull ordering is monotonic even when two requests land in the
 * same millisecond.
 */
export const serverClock = new HybridLogicalClock('server');
