/**
 * Đối soát phí đúng E(u) với phí đã phát hành P(u) — MASTER_PLAN 8.6. Chỉ dòng của chứng từ PUBLISHED vào P(u).
 * Δ > 0 → DEBIT, Δ < 0 → CREDIT, Δ = 0 → không tạo dòng. u chưa phát hành → phí mới, chia dòng theo đoạn.
 */
export interface PublishedLine {
  id: string;
  unitKey: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;
  /** Thứ tự phát hành (để chọn dòng gần nhất cho corrects_item_id). */
  order: number;
}

export interface UnitExpectation<L> {
  unitKey: string;
  expected: bigint;
  /** Dòng phí mới (khi u chưa từng phát hành), tổng bằng `expected`. */
  freshLines: L[];
}

export type Outcome<L> =
  | { kind: 'FRESH'; unitKey: string; lines: L[] }
  | { kind: 'ADJUST'; unitKey: string; direction: 'DEBIT' | 'CREDIT'; amount: bigint; expected: bigint; published: bigint; correctsItemId: string };

export function publishedTotal(lines: PublishedLine[]): bigint {
  return lines.reduce((sum, l) => sum + (l.direction === 'DEBIT' ? l.amount : -l.amount), 0n);
}

/**
 * `skip(unitKey)`: u không đối soát lần này — u lỗi (thiếu giá, thiếu chỉ số) hoặc ngoài mốc tính của chứng từ.
 * Không được coi các u đó là E = 0 (sẽ tạo credit giả).
 */
export function reconcile<L>(units: UnitExpectation<L>[], published: PublishedLine[], skip: (unitKey: string) => boolean = () => false): Outcome<L>[] {
  const byUnit = new Map<string, PublishedLine[]>();
  for (const p of published) byUnit.set(p.unitKey, [...(byUnit.get(p.unitKey) ?? []), p]);
  const out: Outcome<L>[] = [];
  for (const u of units) {
    const lines = byUnit.get(u.unitKey);
    if (!lines?.length) {
      if (u.freshLines.length) out.push({ kind: 'FRESH', unitKey: u.unitKey, lines: u.freshLines });
      continue;
    }
    const p = publishedTotal(lines);
    const delta = u.expected - p;
    if (delta === 0n) continue;
    const latest = [...lines].sort((a, b) => b.order - a.order)[0]!;
    out.push({ kind: 'ADJUST', unitKey: u.unitKey, direction: delta > 0n ? 'DEBIT' : 'CREDIT', amount: delta > 0n ? delta : -delta, expected: u.expected, published: p, correctsItemId: latest.id });
  }
  // u đã phát hành nhưng không còn trong phạm vi tính (VD hủy hợp đồng, phiên bản bị vô hiệu): E(u) = 0.
  const known = new Set(units.map((u) => u.unitKey));
  for (const [unitKey, lines] of byUnit) {
    if (known.has(unitKey) || skip(unitKey)) continue;
    const p = publishedTotal(lines);
    if (p === 0n) continue;
    const latest = [...lines].sort((a, b) => b.order - a.order)[0]!;
    out.push({ kind: 'ADJUST', unitKey, direction: p > 0n ? 'CREDIT' : 'DEBIT', amount: p > 0n ? p : -p, expected: 0n, published: p, correctsItemId: latest.id });
  }
  return out;
}

/** Tổng chứng từ loại nợ: Σ DEBIT − Σ CREDIT. Âm thì phải tách CREDIT sang CREDIT_ADJUSTMENT khi phát hành (D-023). */
export function subtotal(lines: { direction: 'DEBIT' | 'CREDIT'; amount: bigint }[]): bigint {
  return lines.reduce((sum, l) => sum + (l.direction === 'DEBIT' ? l.amount : -l.amount), 0n);
}
