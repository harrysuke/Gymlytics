import { describe, expect, it } from 'vitest';
import {
  featuresForPlan,
  hasFeature,
  parseBeltRanksCsv,
  parseBillingMandatesCsv,
  parseCsv,
  parseMembersCsv,
} from '../saas';

describe('plan entitlements', () => {
  it('falls back to starter for an unknown or missing plan', () => {
    expect(featuresForPlan(null)).toContain('members');
    expect(featuresForPlan('does-not-exist')).toEqual(featuresForPlan('starter'));
  });

  it('keeps advanced modules behind the growth tier', () => {
    expect(featuresForPlan('starter')).not.toContain('csv_import');
    expect(featuresForPlan('growth')).toContain('csv_import');
    expect(featuresForPlan('growth')).not.toContain('multi_site');
    expect(featuresForPlan('network')).toContain('multi_site');
  });

  it('returns a copy so callers cannot mutate the defaults', () => {
    const features = featuresForPlan('starter');
    features.push('advanced_analytics');
    expect(featuresForPlan('starter')).not.toContain('advanced_analytics');
  });

  it('honours a wildcard entitlement', () => {
    expect(hasFeature(['*'], 'multi_site')).toBe(true);
    expect(hasFeature(['members'], 'multi_site')).toBe(false);
    expect(hasFeature(['members', 'csv_import'], 'csv_import')).toBe(true);
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes and CRLF line endings', () => {
    const rows = parseCsv('first,last,note\r\n"Amy","O""Brien","loves, jiu-jitsu"\r\n');
    expect(rows).toEqual([
      ['first', 'last', 'note'],
      ['Amy', 'O"Brien', 'loves, jiu-jitsu'],
    ]);
  });

  it('strips a UTF-8 BOM and skips blank lines', () => {
    expect(parseCsv('\uFEFFa,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseMembersCsv', () => {
  it('accepts snake_case and short header aliases', () => {
    const result = parseMembersCsv(
      'first_name,last_name,email,phone,rank,stripes\nMei,Lim,mei@example.test,+60123456789,blue,2\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual([{
      row: 2,
      value: {
        firstName: 'Mei',
        lastName: 'Lim',
        email: 'mei@example.test',
        phone: '+60123456789',
        role: 'student',
        beltSlug: 'blue',
        stripes: 2,
      },
    }]);
  });

  it('reports a missing required column on row 1', () => {
    const result = parseMembersCsv('email,phone\nmei@example.test,+60123456789\n');
    expect(result.values).toEqual([]);
    expect(result.errors[0]).toMatchObject({ row: 1, message: expect.stringContaining('firstName') });
  });

  it('rejects invalid stripe counts without dropping valid rows', () => {
    const result = parseMembersCsv(
      'firstName,lastName,stripes\nA,One,0\nB,Two,9\nC,Three,1\n',
    );
    expect(result.values.map((row) => row.value.firstName)).toEqual(['A', 'C']);
    expect(result.errors).toEqual([{ row: 3, message: 'Stripes must be an integer from 0 to 4' }]);
  });

  it('returns a row-level error for empty CSV', () => {
    expect(parseMembersCsv('').errors).toEqual([{ row: 0, message: 'CSV is empty' }]);
  });
});

describe('belt rank and mandate imports', () => {
  it('parses belt promotions with optional promotion dates', () => {
    const result = parseBeltRanksCsv('email,beltSlug,stripes,promotedAt\nmei@example.test,purple,1,2026-01-15\n');
    expect(result.values[0]).toEqual({
      row: 2,
      value: { email: 'mei@example.test', beltSlug: 'purple', stripes: 1, promotedAt: '2026-01-15' },
    });
    expect(result.errors).toEqual([]);
  });

  it('requires email and belt for belt rank rows', () => {
    const result = parseBeltRanksCsv('email,belt,stripes\nmei@example.test,,0\n');
    expect(result.values).toEqual([]);
    expect(result.errors[0]?.row).toBe(2);
  });

  it('accepts mandate header aliases', () => {
    const result = parseBillingMandatesCsv(
      'email,provider,customerId,mandateId,cardBrand,lastFour\nmei@example.test,stripe,cus_1,pm_1,visa,4242\n',
    );
    expect(result.values[0]?.value).toEqual({
      email: 'mei@example.test',
      provider: 'stripe',
      providerCustomerId: 'cus_1',
      providerPaymentMethodId: 'pm_1',
      brand: 'visa',
      last4: '4242',
    });
    expect(result.errors).toEqual([]);
  });

  it('rejects a mandate row with missing identifiers', () => {
    const result = parseBillingMandatesCsv('email,provider,customerId,mandateId\nmei@example.test,stripe,,pm_1\n');
    expect(result.values).toEqual([]);
    expect(result.errors[0]?.row).toBe(2);
  });
});
