/**
 * Hybrid Logical Clock (HLC).
 *
 * Wall clocks on tablets drift, get set manually, and jump after battery
 * replacement. A Lamport-style counter layered on physical time gives us:
 *   - monotonic ordering even when NTP steps backwards
 *   - causality capture (observe remote HLC on every pull)
 *   - a lexicographically sortable string, so SQLite `ORDER BY hlc` is correct
 *
 * Format: <ISO-8601>Z-<4-digit counter>-<deviceId>
 * Genesis: 1970-01-01T00:00:00.000Z-0000  (no device suffix)
 */
const HLC_PATTERN = /^(.+Z)-(\d{4})(?:-(.+))?$/;

export interface Hlc {
  timestamp: string;
  counter: number;
  deviceId?: string;
}

export function parseHlc(value: string): Hlc | null {
  const match = HLC_PATTERN.exec(value);
  if (!match) return null;
  const [, timestamp, counter, deviceId] = match;
  return {
    timestamp: timestamp ?? '',
    counter: Number(counter ?? 0),
    ...(deviceId ? { deviceId } : {}),
  };
}

/** Total order: physical time, then counter, then device id for tie-breaks. */
export function compareHlc(a: string, b: string): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.timestamp !== pb.timestamp) return pa.timestamp.localeCompare(pb.timestamp);
  if (pa.counter !== pb.counter) return pa.counter - pb.counter;
  return (pa.deviceId ?? '').localeCompare(pb.deviceId ?? '');
}

export class HybridLogicalClock {
  private lastPhysicalMs = 0;
  private lastCounter = 0;

  constructor(
    private readonly deviceId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Generate the next HLC for a local mutation. */
  tick(): string {
    const physical = this.now();
    if (physical > this.lastPhysicalMs) {
      this.lastPhysicalMs = physical;
      this.lastCounter = 0;
    } else {
      this.lastCounter += 1;
    }
    return this.format();
  }

  /** Absorb a remote HLC so subsequent local writes are causally after it. */
  observe(remote: string): void {
    const parsed = parseHlc(remote);
    if (!parsed) return;
    const remoteMs = Date.parse(parsed.timestamp);
    if (Number.isNaN(remoteMs)) return;
    if (remoteMs > this.lastPhysicalMs) {
      this.lastPhysicalMs = remoteMs;
      this.lastCounter = parsed.counter;
    } else if (remoteMs === this.lastPhysicalMs) {
      this.lastCounter = Math.max(this.lastCounter, parsed.counter);
    }
  }

  private format(): string {
    const iso = new Date(this.lastPhysicalMs).toISOString();
    return `${iso}-${String(this.lastCounter).padStart(4, '0')}-${this.deviceId}`;
  }
}
