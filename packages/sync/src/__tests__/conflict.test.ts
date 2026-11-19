import { describe, expect, it } from 'vitest';
import { resolveRemoteChange, shouldFlagConflict } from '../conflict';

const HLC = '2026-03-01T10:00:00.000Z-0001-kiosk-a';

describe('resolveRemoteChange', () => {
  it('applies when the entity is unknown locally', () => {
    expect(resolveRemoteChange(null, { hlc: HLC, version: 1, entityId: 'x' })).toBe('applied');
  });

  it('treats an identical hlc + version as an idempotent replay', () => {
    const local = { hlc: HLC, version: 1, deviceId: 'kiosk-a' };
    expect(resolveRemoteChange(local, { hlc: HLC, version: 1, entityId: 'x' })).toBe('duplicate');
  });

  it('applies a strictly newer remote change (last writer wins)', () => {
    const local = { hlc: '2026-03-01T09:00:00.000Z-0000-kiosk-a', version: 1, deviceId: 'kiosk-a' };
    expect(resolveRemoteChange(local, { hlc: HLC, version: 2, entityId: 'x' })).toBe('applied');
  });

  it('keeps the local value when the remote change is older', () => {
    const local = { hlc: HLC, version: 2, deviceId: 'kiosk-a' };
    expect(
      resolveRemoteChange(local, {
        hlc: '2026-03-01T09:00:00.000Z-0000-kiosk-b',
        version: 1,
        entityId: 'x',
      }),
    ).toBe('duplicate');
  });

  it('breaks an exact hlc tie on the higher version so both sides converge', () => {
    const local = { hlc: HLC, version: 1, deviceId: 'kiosk-a' };
    expect(resolveRemoteChange(local, { hlc: HLC, version: 3, entityId: 'x' })).toBe('applied');
    expect(resolveRemoteChange({ ...local, version: 4 }, { hlc: HLC, version: 3, entityId: 'x' })).toBe(
      'duplicate',
    );
  });
});

describe('shouldFlagConflict', () => {
  it('flags a losing local write on a mutable entity', () => {
    expect(shouldFlagConflict('booking', 'duplicate', true)).toBe(true);
    expect(shouldFlagConflict('dropin_user', 'duplicate', true)).toBe(true);
  });

  it('never flags append-only facts — a duplicate is just a replay', () => {
    for (const entity of ['attendance_log', 'retail_transaction', 'waiver']) {
      expect(shouldFlagConflict(entity, 'duplicate', true)).toBe(false);
    }
  });

  it('does not flag when nothing was pending locally', () => {
    expect(shouldFlagConflict('booking', 'duplicate', false)).toBe(false);
  });

  it('does not flag an applied change', () => {
    expect(shouldFlagConflict('booking', 'applied', true)).toBe(false);
  });
});
