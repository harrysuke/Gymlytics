import { describe, expect, it } from 'vitest';
import { compareHlc, HybridLogicalClock, parseHlc } from '../hlc';

describe('parseHlc', () => {
  it('parses timestamp, counter and device id', () => {
    expect(parseHlc('2026-03-01T10:00:00.000Z-0007-tablet-a')).toEqual({
      timestamp: '2026-03-01T10:00:00.000Z',
      counter: 7,
      deviceId: 'tablet-a',
    });
  });

  it('parses the genesis form without a device suffix', () => {
    const parsed = parseHlc('1970-01-01T00:00:00.000Z-0000');
    expect(parsed).toEqual({ timestamp: '1970-01-01T00:00:00.000Z', counter: 0 });
    expect(parsed?.deviceId).toBeUndefined();
  });

  it('rejects malformed values', () => {
    expect(parseHlc('nonsense')).toBeNull();
    expect(parseHlc('2026-03-01T10:00:00.000Z')).toBeNull();
  });
});

describe('compareHlc', () => {
  it('orders by physical time first', () => {
    expect(
      compareHlc('2026-03-01T10:00:01.000Z-0000-a', '2026-03-01T10:00:00.000Z-9999-a'),
    ).toBeGreaterThan(0);
  });

  it('orders by counter when the physical time matches', () => {
    expect(
      compareHlc('2026-03-01T10:00:00.000Z-0002-a', '2026-03-01T10:00:00.000Z-0001-a'),
    ).toBeGreaterThan(0);
  });

  it('breaks ties deterministically on device id', () => {
    expect(compareHlc('2026-03-01T10:00:00.000Z-0000-b', '2026-03-01T10:00:00.000Z-0000-a')).toBeGreaterThan(0);
    expect(compareHlc('2026-03-01T10:00:00.000Z-0000-a', '2026-03-01T10:00:00.000Z-0000-a')).toBe(0);
  });

  it('produces a total order across a shuffled set', () => {
    const values = [
      '2026-03-01T10:00:00.000Z-0001-b',
      '2026-03-01T10:00:00.000Z-0000-z',
      '2026-03-01T09:59:59.999Z-0500-a',
      '2026-03-01T10:00:00.000Z-0001-a',
      '2026-03-01T10:00:01.000Z-0000-a',
    ];
    const sorted = [...values].sort(compareHlc);
    expect(sorted).toEqual([
      '2026-03-01T09:59:59.999Z-0500-a',
      '2026-03-01T10:00:00.000Z-0000-z',
      '2026-03-01T10:00:00.000Z-0001-a',
      '2026-03-01T10:00:00.000Z-0001-b',
      '2026-03-01T10:00:01.000Z-0000-a',
    ]);
  });
});

describe('HybridLogicalClock', () => {
  it('starts at counter zero for the first tick', () => {
    const clock = new HybridLogicalClock('kiosk-1', () => 1_000);
    expect(clock.tick()).toBe('1970-01-01T00:00:01.000Z-0000-kiosk-1');
  });

  it('increments the counter when the wall clock stands still', () => {
    const clock = new HybridLogicalClock('kiosk-1', () => 1_000);
    clock.tick();
    expect(clock.tick()).toBe('1970-01-01T00:00:01.000Z-0001-kiosk-1');
    expect(clock.tick()).toBe('1970-01-01T00:00:01.000Z-0002-kiosk-1');
  });

  it('stays monotonic when NTP steps the clock backwards', () => {
    let now = 5_000;
    const clock = new HybridLogicalClock('kiosk-1', () => now);
    const first = clock.tick();
    now = 2_000; // clock jumped back
    const second = clock.tick();
    expect(compareHlc(second, first)).toBeGreaterThan(0);
  });

  it('resets the counter when physical time advances', () => {
    let now = 1_000;
    const clock = new HybridLogicalClock('kiosk-1', () => now);
    clock.tick();
    clock.tick();
    now = 2_000;
    expect(clock.tick()).toBe('1970-01-01T00:00:02.000Z-0000-kiosk-1');
  });

  it('absorbs a remote HLC so later local writes are causally after it', () => {
    let now = 1_000;
    const clock = new HybridLogicalClock('kiosk-1', () => now);
    clock.observe('1970-01-01T00:00:10.000Z-0005-server');
    const next = clock.tick();
    expect(compareHlc(next, '1970-01-01T00:00:10.000Z-0005-server')).toBeGreaterThan(0);
  });

  it('keeps the higher counter when remote time equals local time', () => {
    const clock = new HybridLogicalClock('kiosk-1', () => 10_000);
    clock.tick();
    clock.observe('1970-01-01T00:00:10.000Z-0009-server');
    expect(clock.tick()).toBe('1970-01-01T00:00:10.000Z-0010-kiosk-1');
  });

  it('ignores an unparseable remote HLC', () => {
    const clock = new HybridLogicalClock('kiosk-1', () => 1_000);
    clock.observe('garbage');
    expect(clock.tick()).toBe('1970-01-01T00:00:01.000Z-0000-kiosk-1');
  });
});
