import { createHash } from 'node:crypto';

/** JSON với key được sắp xếp, để cùng payload luôn cho cùng chuỗi bất kể thứ tự field. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  );
}

export function requestHash(route: string, payload: unknown): string {
  return createHash('sha256').update(stableStringify({ route, payload })).digest('hex');
}
