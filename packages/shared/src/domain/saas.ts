import { PLAN_FEATURE_DEFAULTS, type SaasFeature } from '../constants';

/** Feature entitlement for an academy's active subscription. */
export function featuresForPlan(slug: string | null | undefined): SaasFeature[] {
  if (!slug) return [...PLAN_FEATURE_DEFAULTS['starter']!];
  return [...(PLAN_FEATURE_DEFAULTS[slug] ?? PLAN_FEATURE_DEFAULTS['starter']!)];
}

export function hasFeature(features: readonly string[], feature: string): boolean {
  return features.includes(feature) || features.includes('*');
}

/**
 * RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF, and trailing
 * newlines. Deliberately dependency-free so it runs in Node and the browser.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] as string;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

export const normaliseHeader = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_-]+/g,'');

export interface ParsedRow<T> {
  row: number;
  value: T;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ParseResult<T> {
  values: ParsedRow<T>[];
  errors: ImportRowError[];
}

/** Map a header row to canonical column names, tolerating common aliases. */
function columnIndex(headers: string[], aliases: string[], required: boolean): number {
  const set = new Set(aliases.map(normaliseHeader));
  const index = headers.findIndex((header) => set.has(normaliseHeader(header)));
  if (index === -1 && required) {
    throw new Error(`Missing required column: ${aliases[0]}`);
  }
  return index;
}

export interface MemberImportRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  pin?: string;
  beltSlug?: string;
  stripes?: number;
}

export function parseMembersCsv(text: string): ParseResult<MemberImportRow> {
  const rows = parseCsv(text);
  const errors: ParseResult<MemberImportRow>['errors'] = [];
  const values: ParsedRow<MemberImportRow>[] = [];
  if (rows.length === 0) return { values, errors: [{ row: 0, message: 'CSV is empty' }] };

  const headers = rows[0]!;
  try {
    const first = columnIndex(headers, ['firstName', 'first_name', 'first'], true);
    const last = columnIndex(headers, ['lastName', 'last_name', 'last'], true);
    const email = columnIndex(headers, ['email', 'emailAddress'], false);
    const phone = columnIndex(headers, ['phone', 'mobile'], false);
    const role = columnIndex(headers, ['role'], false);
    const pin = columnIndex(headers, ['pin'], false);
    const belt = columnIndex(headers, ['belt', 'beltSlug', 'rank'], false);
    const stripes = columnIndex(headers, ['stripes'], false);

    rows.slice(1).forEach((cells, index) => {
      const rowNumber = index + 2;
      const firstName = cells[first]?.trim() ?? '';
      const lastName = cells[last]?.trim() ?? '';
      if (!firstName || !lastName) {
        errors.push({ row: rowNumber, message: 'First and last name are required' });
        return;
      }
      const stripeCount = stripes >= 0 ? Number(cells[stripes] ?? 0) : 0;
      if (!Number.isInteger(stripeCount) || stripeCount < 0 || stripeCount > 4) {
        errors.push({ row: rowNumber, message: 'Stripes must be an integer from 0 to 4' });
        return;
      }
      const value: MemberImportRow = {
        firstName,
        lastName,
        role: role >= 0 && cells[role] ? (cells[role] as string) : 'student',
        ...(email >= 0 && cells[email] ? { email: cells[email] } : {}),
        ...(phone >= 0 && cells[phone] ? { phone: cells[phone] } : {}),
        ...(pin >= 0 && cells[pin] ? { pin: cells[pin] } : {}),
        ...(belt >= 0 && cells[belt] ? { beltSlug: cells[belt] } : {}),
        ...(stripeCount ? { stripes: stripeCount } : {}),
      };
      values.push({ row: rowNumber, value });
    });
  } catch (error) {
    errors.push({ row: 1, message: error instanceof Error ? error.message : 'Invalid header row' });
  }
  return { values, errors };
}

export interface BeltRankImportRow {
  email: string;
  beltSlug: string;
  stripes: number;
  promotedAt?: string;
}

export function parseBeltRanksCsv(text: string): ParseResult<BeltRankImportRow> {
  const rows = parseCsv(text);
  const errors: ParseResult<BeltRankImportRow>['errors'] = [];
  const values: ParsedRow<BeltRankImportRow>[] = [];
  if (rows.length === 0) return { values, errors: [{ row: 0, message: 'CSV is empty' }] };
  const headers = rows[0]!;
  try {
    const email = columnIndex(headers, ['email'], true);
    const belt = columnIndex(headers, ['beltSlug', 'belt', 'rank'], true);
    const stripes = columnIndex(headers, ['stripes'], false);
    const promoted = columnIndex(headers, ['promotedAt', 'promoted_at', 'date'], false);
    rows.slice(1).forEach((cells, index) => {
      const rowNumber = index + 2;
      const count = stripes >= 0 ? Number(cells[stripes] ?? 0) : 0;
      if (!cells[email] || !cells[belt] || !Number.isInteger(count) || count < 0 || count > 4) {
        errors.push({ row: rowNumber, message: 'email, belt and stripes (0-4) are required' });
        return;
      }
      values.push({
        row: rowNumber,
        value: {
          email: cells[email] as string,
          beltSlug: cells[belt] as string,
          stripes: count,
          ...(promoted >= 0 && cells[promoted] ? { promotedAt: cells[promoted] } : {}),
        },
      });
    });
  } catch (error) {
    errors.push({ row: 1, message: error instanceof Error ? error.message : 'Invalid header row' });
  }
  return { values, errors };
}

export interface BillingMandateImportRow {
  email: string;
  provider: string;
  providerCustomerId: string;
  providerPaymentMethodId: string;
  brand?: string;
  last4?: string;
}

export function parseBillingMandatesCsv(text: string): ParseResult<BillingMandateImportRow> {
  const rows = parseCsv(text);
  const errors: ParseResult<BillingMandateImportRow>['errors'] = [];
  const values: ParsedRow<BillingMandateImportRow>[] = [];
  if (rows.length === 0) return { values, errors: [{ row: 0, message: 'CSV is empty' }] };
  const headers = rows[0]!;
  try {
    const email = columnIndex(headers, ['email'], true);
    const provider = columnIndex(headers, ['provider'], true);
    const customer = columnIndex(headers, ['providerCustomerId', 'customerId', 'customer'], true);
    const method = columnIndex(headers, ['providerPaymentMethodId', 'paymentMethodId', 'mandateId'], true);
    const brand = columnIndex(headers, ['brand', 'cardBrand'], false);
    const last4 = columnIndex(headers, ['last4', 'lastFour'], false);
    rows.slice(1).forEach((cells, index) => {
      const rowNumber = index + 2;
      if (!cells[email] || !cells[provider] || !cells[customer] || !cells[method]) {
        errors.push({ row: rowNumber, message: 'email, provider, customer and mandate ids are required' });
        return;
      }
      values.push({
        row: rowNumber,
        value: {
          email: cells[email] as string,
          provider: cells[provider] as string,
          providerCustomerId: cells[customer] as string,
          providerPaymentMethodId: cells[method] as string,
          ...(brand >= 0 && cells[brand] ? { brand: cells[brand] } : {}),
          ...(last4 >= 0 && cells[last4] ? { last4: cells[last4] } : {}),
        },
      });
    });
  } catch (error) {
    errors.push({ row: 1, message: error instanceof Error ? error.message : 'Invalid header row' });
  }
  return { values, errors };
}
