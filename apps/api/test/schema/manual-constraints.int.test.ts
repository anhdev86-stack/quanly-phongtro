import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { createTestApp, resetDatabase, type TestApp } from '../helpers/test-app.js';

/**
 * T47 — ràng buộc SQL thủ công: định nghĩa khớp danh mục prisma/MANUAL_SQL.md và hành vi đúng.
 * Danh mục là nguồn sự thật; thêm ràng buộc vào danh mục mà chưa thêm test hành vi thì test fail.
 */
interface CatalogEntry {
  name: string;
  kind: 'check' | 'extension' | 'index' | 'exclude' | 'function';
  table: string | null;
  definition: string;
}

function readCatalog(): CatalogEntry[] {
  const md = fs.readFileSync(path.join(process.cwd(), 'prisma', 'MANUAL_SQL.md'), 'utf8');
  const match = /```json manual-constraints\r?\n([\s\S]*?)```/.exec(md);
  if (!match?.[1]) throw new Error('Không tìm thấy khối ```json manual-constraints trong MANUAL_SQL.md');
  return JSON.parse(match[1]) as CatalogEntry[];
}

class Rollback extends Error {}

describe('T47 — ràng buộc SQL thủ công', () => {
  let t: TestApp;
  let userId: string;
  const catalog = readCatalog();

  /** Chạy fn trong transaction rồi luôn rollback; trả lỗi database nếu có. */
  async function attempt(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<Error | null> {
    try {
      await t.prisma.$transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) return null;
      return error as Error;
    }
    return null;
  }

  const expectAccepted = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    expect(await attempt(fn)).toBeNull();
  const expectRejected = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, constraint: string) => {
    const error = await attempt(fn);
    expect(error, `phải bị ràng buộc ${constraint} từ chối`).not.toBeNull();
    expect(`${error?.message} ${JSON.stringify(error)}`).toContain(constraint);
  };

  /** Mỗi ràng buộc trong danh mục phải có một case hợp lệ sát biên và ít nhất một case vi phạm. */
  const behaviours: Record<string, () => Promise<void>> = {
    btree_gist: async () => {
      const setup = async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE gist_probe (k uuid, r daterange,
          EXCLUDE USING gist (k WITH =, r WITH &&)) ON COMMIT DROP`);
      };
      const k = SEED_IDS.workspace;
      await expectAccepted(async (tx) => {
        await setup(tx);
        await tx.$executeRawUnsafe(`INSERT INTO gist_probe VALUES ($1::uuid, '[2026-10-01,2026-10-06)'), ($1::uuid, '[2026-10-06,2026-10-10)')`, k);
      });
      const error = await attempt(async (tx) => {
        await setup(tx);
        await tx.$executeRawUnsafe(`INSERT INTO gist_probe VALUES ($1::uuid, '[2026-10-01,2026-10-07)'), ($1::uuid, '[2026-10-06,2026-10-10)')`, k);
      });
      expect(String(error?.message ?? JSON.stringify(error))).toMatch(/exclusion|gist_probe/i);
    },

    users_email_lowercase_chk: async () => {
      const insert = (email: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO users (id, workspace_id, email, password_hash, display_name, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, 'x', 'Probe', now())`,
          SEED_IDS.workspace,
          email,
        );
      await expectAccepted(insert('lowercase.probe@example.test'));
      await expectRejected(insert('Upper.Probe@example.test'), 'users_email_lowercase_chk');
    },

    refresh_sessions_expiry_chk: async () => {
      const insert = (expiresOffset: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO refresh_sessions (id, user_id, family_id, token_hash, created_at, expires_at)
           VALUES (gen_random_uuid(), $1::uuid, gen_random_uuid(), md5(random()::text), '2026-10-06T00:00:00Z',
                   '2026-10-06T00:00:00Z'::timestamptz + $2::interval)`,
          userId,
          expiresOffset,
        );
      await expectAccepted(insert('1 millisecond'));
      await expectRejected(insert('0 seconds'), 'refresh_sessions_expiry_chk');
    },

    idempotency_requests_key_format_chk: async () => {
      const insert = (key: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO idempotency_requests (id, workspace_id, actor_id, route, key, request_hash, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'POST /probe', $3, 'h', now())`,
          SEED_IDS.workspace,
          userId,
          key,
        );
      await expectAccepted(insert('a'.repeat(8)));
      await expectAccepted(insert('b'.repeat(128)));
      await expectRejected(insert('a'.repeat(7)), 'idempotency_requests_key_format_chk');
      await expectRejected(insert('c'.repeat(129)), 'idempotency_requests_key_format_chk');
      await expectRejected(insert('khoá có dấu cách'), 'idempotency_requests_key_format_chk');
    },

    idempotency_requests_done_has_status_chk: async () => {
      const insert = (status: string, responseStatus: number | null) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO idempotency_requests (id, workspace_id, actor_id, route, key, request_hash, status, response_status, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'POST /probe', 'key-done-0001', 'h', $3::"IdempotencyStatus", $4, now())`,
          SEED_IDS.workspace,
          userId,
          status,
          responseStatus,
        );
      await expectAccepted(insert('DONE', 201));
      await expectAccepted(insert('IN_PROGRESS', null));
      await expectRejected(insert('DONE', null), 'idempotency_requests_done_has_status_chk');
    },

    rooms_default_rent_nonneg_chk: async () => {
      await expectAccepted(insertRoom({ rent: 0 }));
      await expectRejected(insertRoom({ rent: -1 }), 'rooms_default_rent_nonneg_chk');
    },

    rooms_max_occupants_chk: async () => {
      await expectAccepted(insertRoom({ maxOccupants: 1 }));
      await expectAccepted(insertRoom({ maxOccupants: 50 }));
      await expectRejected(insertRoom({ maxOccupants: 0 }), 'rooms_max_occupants_chk');
      await expectRejected(insertRoom({ maxOccupants: 51 }), 'rooms_max_occupants_chk');
    },

    reservations_dates_order_chk: async () => {
      await expectAccepted(async (tx) => insertReservation(tx, await roomInTx(tx), '2026-10-10', '2026-10-10', '2026-10-10'));
      await expectRejected(async (tx) => insertReservation(tx, await roomInTx(tx), '2026-10-10', '2026-10-09', '2026-10-12'), 'reservations_dates_order_chk');
      await expectRejected(async (tx) => insertReservation(tx, await roomInTx(tx), '2026-10-10', '2026-10-13', '2026-10-12'), 'reservations_dates_order_chk');
    },

    no_overlapping_active_reservations: async () => {
      // Sát biên: [10..15] và [16..20] không giao nhau
      await expectAccepted(async (tx) => {
        const room = await roomInTx(tx);
        await insertReservation(tx, room, '2026-10-10', '2026-10-10', '2026-10-15');
        await insertReservation(tx, room, '2026-10-16', '2026-10-16', '2026-10-20');
      });
      // Lượt CANCELLED không chặn
      await expectAccepted(async (tx) => {
        const room = await roomInTx(tx);
        await insertReservation(tx, room, '2026-10-10', '2026-10-10', '2026-10-15', 'CANCELLED');
        await insertReservation(tx, room, '2026-10-12', '2026-10-12', '2026-10-14');
      });
      await expectRejected(async (tx) => {
        const room = await roomInTx(tx);
        await insertReservation(tx, room, '2026-10-10', '2026-10-10', '2026-10-15');
        await insertReservation(tx, room, '2026-10-15', '2026-10-15', '2026-10-18');
      }, 'no_overlapping_active_reservations');
    },
  };

  // ---------------- Phase 2 ----------------
  const W = SEED_IDS.workspace;
  let n = 0;
  const mkRoom = async (tx: Prisma.TransactionClient) =>
    (await tx.room.create({ data: { workspaceId: W, buildingId: SEED_IDS.buildings.A, code: `P2R${++n}`, defaultRentVnd: 1n, maxOccupants: 5 } })).id;
  const mkTenancy = async (tx: Prisma.TransactionClient, roomId: string, extra: Record<string, unknown> = {}) =>
    (await tx.tenancy.create({ data: { workspaceId: W, roomId, code: `P2T${++n}`, startDate: new Date('2026-10-01'), createdBy: userId, ...extra } })).id;
  const mkTenant = async (tx: Prisma.TransactionClient) => (await tx.tenant.create({ data: { workspaceId: W, fullName: `T${++n}` } })).id;
  const member = (tx: Prisma.TransactionClient, tenancyId: string, tenantId: string, role: 'PRIMARY' | 'MEMBER', joined: string, left: string | null = null) =>
    tx.tenancyTenant.create({ data: { workspaceId: W, tenancyId, tenantId, role, joinedOn: new Date(joined), leftOnExclusive: left ? new Date(left) : null } });
  const svc = async (tx: Prisma.TransactionClient, code = 'INTERNET') => (await tx.service.findFirstOrThrow({ where: { code } })).id;
  const tenancyService = (tx: Prisma.TransactionClient, tenancyId: string, serviceId: string, from: string, end: string | null, extra: Record<string, unknown> = {}) =>
    tx.tenancyService.create({ data: { tenancyId, serviceId, effectiveFrom: new Date(from), endExclusive: end ? new Date(end) : null, createdBy: userId, ...extra } });
  const meter = async (tx: Prisma.TransactionClient, roomId: string, extra: Record<string, unknown> = {}) =>
    (await tx.meter.create({ data: { workspaceId: W, roomId, type: 'ELECTRICITY', installedOn: new Date('2026-10-01'), initialReading: '0', createdBy: userId, ...extra } })).id;
  const deposit = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
    const tenancyId = await mkTenancy(tx, await mkRoom(tx));
    return tx.depositTransaction.create({ data: { workspaceId: W, tenancyId, type: 'RECEIVED', amountVnd: 1n, createdBy: userId, ...extra } });
  };
  const holding = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
    const r = await tx.reservation.create({
      data: { workspaceId: W, roomId: await mkRoom(tx), holdFrom: new Date('2026-10-01'), expectedMoveIn: new Date('2026-10-01'), holdUntil: new Date('2026-10-02'), contactName: 'x', createdBy: userId },
    });
    return tx.holdingTransaction.create({ data: { workspaceId: W, reservationId: r.id, type: 'RECEIVED', amountVnd: 1n, createdBy: userId, ...extra } });
  };

  Object.assign(behaviours, {
    one_open_tenancy_per_room: async () => {
      await expectAccepted(async (tx) => {
        const room = await mkRoom(tx);
        await mkTenancy(tx, room, { status: 'ENDED', chargeEndExclusive: new Date('2026-10-05') });
        await mkTenancy(tx, room);
      });
      for (const second of ['NOTICE_GIVEN', 'MOVE_OUT_PROCESSING', 'ACTIVE']) {
        await expectRejected(async (tx) => {
          const room = await mkRoom(tx);
          await mkTenancy(tx, room);
          await mkTenancy(tx, room, { status: second });
        }, 'one_open_tenancy_per_room');
      }
    },
    tenancies_charge_end_chk: async () => {
      await expectAccepted(async (tx) => mkTenancy(tx, await mkRoom(tx), { status: 'ENDED', chargeEndExclusive: new Date('2026-10-02') }));
      await expectRejected(async (tx) => mkTenancy(tx, await mkRoom(tx), { status: 'ENDED', chargeEndExclusive: new Date('2026-10-01') }), 'tenancies_charge_end_chk');
    },
    tenancies_billing_due_day_chk: async () => {
      await expectAccepted(async (tx) => mkTenancy(tx, await mkRoom(tx), { billingDueDay: 31 }));
      await expectRejected(async (tx) => mkTenancy(tx, await mkRoom(tx), { billingDueDay: 0 }), 'tenancies_billing_due_day_chk');
      await expectRejected(async (tx) => mkTenancy(tx, await mkRoom(tx), { billingDueDay: 32 }), 'tenancies_billing_due_day_chk');
    },
    tenancies_deposit_required_chk: async () => {
      await expectAccepted(async (tx) => mkTenancy(tx, await mkRoom(tx), { initialDepositRequiredVnd: 0n }));
      await expectRejected(async (tx) => mkTenancy(tx, await mkRoom(tx), { initialDepositRequiredVnd: -1n }), 'tenancies_deposit_required_chk');
    },
    one_current_primary: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await member(tx, tn, await mkTenant(tx), 'PRIMARY', '2026-10-01', '2026-10-05');
        await member(tx, tn, await mkTenant(tx), 'PRIMARY', '2026-10-01');
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await member(tx, tn, await mkTenant(tx), 'PRIMARY', '2026-10-01');
        await member(tx, tn, await mkTenant(tx), 'PRIMARY', '2026-10-02');
      }, 'one_current_primary');
    },
    tenancy_tenants_dates_chk: async () => {
      await expectAccepted(async (tx) => member(tx, await mkTenancy(tx, await mkRoom(tx)), await mkTenant(tx), 'MEMBER', '2026-10-01', '2026-10-02'));
      await expectRejected(async (tx) => member(tx, await mkTenancy(tx, await mkRoom(tx)), await mkTenant(tx), 'MEMBER', '2026-10-01', '2026-10-01'), 'tenancy_tenants_dates_chk');
    },
    no_overlapping_membership: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const p = await mkTenant(tx);
        await member(tx, tn, p, 'MEMBER', '2026-10-01', '2026-10-05');
        await member(tx, tn, p, 'MEMBER', '2026-10-05');
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const p = await mkTenant(tx);
        await member(tx, tn, p, 'MEMBER', '2026-10-01', '2026-10-06');
        await member(tx, tn, p, 'MEMBER', '2026-10-05');
      }, 'no_overlapping_membership');
    },
    one_active_rent_price_per_day: async () => {
      const price = (tx: Prisma.TransactionClient, tn: string, status: 'ACTIVE' | 'VOIDED') =>
        tx.rentPriceHistory.create({ data: { tenancyId: tn, effectiveFrom: new Date('2026-11-01'), monthlyRentVnd: 1n, status, createdBy: userId } });
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await price(tx, tn, 'VOIDED');
        await price(tx, tn, 'ACTIVE');
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await price(tx, tn, 'ACTIVE');
        await price(tx, tn, 'ACTIVE');
      }, 'one_active_rent_price_per_day');
    },
    rent_price_nonneg_chk: async () => {
      const price = async (tx: Prisma.TransactionClient, v: bigint) =>
        tx.rentPriceHistory.create({ data: { tenancyId: await mkTenancy(tx, await mkRoom(tx)), effectiveFrom: new Date('2026-11-01'), monthlyRentVnd: v, createdBy: userId } });
      await expectAccepted((tx) => price(tx, 0n));
      await expectRejected((tx) => price(tx, -1n), 'rent_price_nonneg_chk');
    },
    no_overlapping_tenancy_services: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const s = await svc(tx);
        await tenancyService(tx, tn, s, '2026-10-01', '2026-10-15');
        await tenancyService(tx, tn, s, '2026-10-15', null);
        await tenancyService(tx, tn, s, '2026-10-10', null, { status: 'VOIDED' });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const s = await svc(tx);
        await tenancyService(tx, tn, s, '2026-10-01', null);
        await tenancyService(tx, tn, s, '2026-10-10', null);
      }, 'no_overlapping_tenancy_services');
    },
    tenancy_services_dates_qty_chk: async () => {
      await expectAccepted(async (tx) => tenancyService(tx, await mkTenancy(tx, await mkRoom(tx)), await svc(tx), '2026-10-01', '2026-10-02', { quantity: '0' }));
      await expectRejected(async (tx) => tenancyService(tx, await mkTenancy(tx, await mkRoom(tx)), await svc(tx), '2026-10-01', null, { quantity: '-1' }), 'tenancy_services_dates_qty_chk');
      await expectRejected(async (tx) => tenancyService(tx, await mkTenancy(tx, await mkRoom(tx)), await svc(tx), '2026-10-01', '2026-10-01'), 'tenancy_services_dates_qty_chk');
    },
    services_meter_chk: async () => {
      const mk = (tx: Prisma.TransactionClient, data: Record<string, unknown>) =>
        tx.service.create({ data: { workspaceId: W, code: `S${++n}`, name: 'x', unit: 'x', type: 'METER', ...data } as never });
      await expectAccepted((tx) => mk(tx, { chargeTiming: 'ARREARS', meterType: 'WATER' }));
      await expectRejected((tx) => mk(tx, { chargeTiming: 'ARREARS', meterType: null }), 'services_meter_chk');
      await expectRejected((tx) => mk(tx, { chargeTiming: 'ADVANCE', meterType: 'WATER' }), 'services_meter_chk');
      await expectRejected((tx) => mk(tx, { type: 'FIXED_ROOM', chargeTiming: 'ADVANCE', meterType: 'WATER' }), 'services_meter_chk');
    },
    one_active_meter_per_type: async () => {
      await expectAccepted(async (tx) => {
        const room = await mkRoom(tx);
        await meter(tx, room, { retiredOn: new Date('2026-10-05') });
        await meter(tx, room);
        await meter(tx, room, { type: 'WATER' });
      });
      await expectRejected(async (tx) => {
        const room = await mkRoom(tx);
        await meter(tx, room);
        await meter(tx, room);
      }, 'one_active_meter_per_type');
    },
    meters_initial_reading_chk: async () => {
      await expectAccepted(async (tx) => meter(tx, await mkRoom(tx), { initialReading: '0' }));
      await expectRejected(async (tx) => meter(tx, await mkRoom(tx), { initialReading: '-0.01' }), 'meters_initial_reading_chk');
    },
    meter_readings_value_chk: async () => {
      const reading = async (tx: Prisma.TransactionClient, value: string) =>
        tx.meterReading.create({ data: { meterId: await meter(tx, await mkRoom(tx)), readOn: new Date('2026-10-02'), value, kind: 'INITIAL', createdBy: userId } });
      await expectAccepted((tx) => reading(tx, '0'));
      await expectRejected((tx) => reading(tx, '-1'), 'meter_readings_value_chk');
    },
    deposit_amount_positive_chk: async () => {
      await expectAccepted((tx) => deposit(tx, { amountVnd: 1n }));
      await expectRejected((tx) => deposit(tx, { amountVnd: 0n }), 'deposit_amount_positive_chk');
    },
    deposit_reversal_ref_chk: async () => {
      await expectAccepted(async (tx) => {
        const d = await deposit(tx, {});
        await tx.depositTransaction.create({ data: { workspaceId: W, tenancyId: d.tenancyId, type: 'REVERSAL', amountVnd: 1n, reversesTransactionId: d.id, createdBy: userId } });
      });
      await expectRejected((tx) => deposit(tx, { type: 'REVERSAL' }), 'deposit_reversal_ref_chk');
      await expectRejected(async (tx) => {
        const d = await deposit(tx, {});
        await tx.depositTransaction.create({ data: { workspaceId: W, tenancyId: d.tenancyId, type: 'REFUND', amountVnd: 1n, reversesTransactionId: d.id, createdBy: userId } });
      }, 'deposit_reversal_ref_chk');
    },
    holding_amount_positive_chk: async () => {
      await expectAccepted((tx) => holding(tx, { amountVnd: 1n }));
      await expectRejected((tx) => holding(tx, { amountVnd: 0n }), 'holding_amount_positive_chk');
    },
    holding_reversal_ref_chk: async () => {
      await expectAccepted(async (tx) => {
        const h = await holding(tx, {});
        await tx.holdingTransaction.create({ data: { workspaceId: W, reservationId: h.reservationId, type: 'REVERSAL', amountVnd: 1n, reversesTransactionId: h.id, createdBy: userId } });
      });
      await expectRejected((tx) => holding(tx, { type: 'REVERSAL' }), 'holding_reversal_ref_chk');
    },
    contracts_term_chk: async () => {
      await expectAccepted(async (tx) => contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-01', '2026-10-01'));
      await expectRejected(async (tx) => contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-02', '2026-10-01'), 'contracts_term_chk');
    },
    contracts_signed_at_chk: async () => {
      await expectAccepted(async (tx) => contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-01', '2027-03-31', { lifecycle: 'SIGNED', signedAt: new Date('2026-10-01') }));
      await expectRejected(async (tx) => contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-01', '2027-03-31', { lifecycle: 'SIGNED' }), 'contracts_signed_at_chk');
    },
    no_overlapping_signed_contracts: async () => {
      const signed = { lifecycle: 'SIGNED', signedAt: new Date('2026-10-01') };
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await contract(tx, tn, '2026-10-01', '2027-03-31', signed);
        await contract(tx, tn, '2027-04-01', '2027-09-30', signed);
        await contract(tx, tn, '2026-12-01', '2027-05-31'); // DRAFT chồng thì được
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await contract(tx, tn, '2026-10-01', '2027-03-31', signed);
        await contract(tx, tn, '2027-03-31', '2027-09-30', signed);
      }, 'no_overlapping_signed_contracts');
    },
    contract_effective_status: async () => {
      const at = async (lifecycle: string, terminated: string | null, on: string) =>
        (await t.prisma.$queryRawUnsafe<{ s: string }[]>(
          `SELECT contract_effective_status($1::"ContractLifecycle", $2::date, '2026-10-01'::date, '2027-03-31'::date, $3::date) AS s`,
          lifecycle, terminated, on,
        ))[0]!.s;
      expect(await at('SIGNED', null, '2026-09-30')).toBe('SCHEDULED');
      expect(await at('SIGNED', null, '2026-10-01')).toBe('ACTIVE');
      expect(await at('SIGNED', null, '2027-03-31')).toBe('ACTIVE');
      expect(await at('SIGNED', null, '2027-04-01')).toBe('EXPIRED');
      expect(await at('SIGNED', '2026-12-15', '2026-11-01')).toBe('TERMINATED_EARLY');
      expect(await at('DRAFT', null, '2026-11-01')).toBe('DRAFT');
      expect(await at('CANCELLED', null, '2026-11-01')).toBe('CANCELLED');
    },

    // ---------------- Phase 4 ----------------
    one_building_service_price_per_day: async () => {
      await expectAccepted(async (tx) => {
        const s = await svc(tx, 'ELEC');
        await price(tx, s, SEED_IDS.buildings.A, '2026-10-01');
        await price(tx, s, SEED_IDS.buildings.B, '2026-10-01');
        await price(tx, s, SEED_IDS.buildings.B, '2026-11-01');
      });
      await expectRejected(async (tx) => {
        const s = await svc(tx, 'ELEC');
        await price(tx, s, SEED_IDS.buildings.B, '2026-10-01');
        await price(tx, s, SEED_IDS.buildings.B, '2026-10-01');
      }, 'one_building_service_price_per_day');
    },
    one_general_service_price_per_day: async () => {
      await expectAccepted(async (tx) => {
        const s = await svc(tx);
        await price(tx, s, null, '2026-10-01');
        await price(tx, s, SEED_IDS.buildings.A, '2026-10-01');
        await price(tx, s, null, '2026-11-01');
      });
      await expectRejected(async (tx) => {
        const s = await svc(tx);
        await price(tx, s, null, '2026-10-01');
        await price(tx, s, null, '2026-10-01');
      }, 'one_general_service_price_per_day');
    },
    service_price_nonneg_chk: async () => {
      await expectAccepted(async (tx) => price(tx, await svc(tx), null, '2026-10-01', '0'));
      await expectRejected(async (tx) => price(tx, await svc(tx), null, '2026-10-01', '-0.01'), 'service_price_nonneg_chk');
    },
    services_substitutes_chk: async () => {
      const mk = (tx: Prisma.TransactionClient, data: Record<string, unknown>) =>
        tx.service.create({ data: { workspaceId: W, code: `S${++n}`, name: 'x', unit: 'x', ...data } as never });
      await expectAccepted((tx) => mk(tx, { type: 'PER_PERSON', substitutesMeter: 'WATER' }));
      await expectRejected((tx) => mk(tx, { type: 'METER', chargeTiming: 'ARREARS', meterType: 'WATER', substitutesMeter: 'WATER' }), 'services_substitutes_chk');
    },
    statement_periods_month_start_chk: async () => {
      await expectAccepted((tx) => period(tx, '2031-01-01'));
      await expectRejected((tx) => period(tx, '2031-01-02'), 'statement_periods_month_start_chk');
    },
    meter_readings_period_chk: async () => {
      const reading = async (tx: Prisma.TransactionClient, kind: string, withPeriod: boolean) =>
        tx.meterReading.create({
          data: { meterId: await meter(tx, await mkRoom(tx)), readOn: new Date('2026-10-31'), value: '1', kind, statementPeriodId: withPeriod ? await period(tx, '2031-02-01') : null, createdBy: userId } as never,
        });
      await expectAccepted((tx) => reading(tx, 'PERIODIC', true));
      await expectAccepted((tx) => reading(tx, 'INITIAL', false));
      await expectRejected((tx) => reading(tx, 'PERIODIC', false), 'meter_readings_period_chk');
      await expectRejected((tx) => reading(tx, 'FINAL', true), 'meter_readings_period_chk');
    },
    one_periodic_reading_per_period: async () => {
      const periodic = (tx: Prisma.TransactionClient, meterId: string, periodId: string, on: string) =>
        tx.meterReading.create({ data: { meterId, readOn: new Date(on), value: '1', kind: 'PERIODIC', statementPeriodId: periodId, createdBy: userId } });
      await expectAccepted(async (tx) => {
        const m = await meter(tx, await mkRoom(tx));
        await periodic(tx, m, await period(tx, '2031-03-01'), '2026-10-30');
        await periodic(tx, m, await period(tx, '2031-04-01'), '2026-11-30');
        await tx.meterReading.create({ data: { meterId: m, readOn: new Date('2026-11-10'), value: '1', kind: 'CLOSING', createdBy: userId } });
      });
      await expectRejected(async (tx) => {
        const m = await meter(tx, await mkRoom(tx));
        const p = await period(tx, '2031-05-01');
        await periodic(tx, m, p, '2026-10-30');
        await periodic(tx, m, p, '2026-10-31');
      }, 'one_periodic_reading_per_period');
    },
    meters_retired_after_installed_chk: async () => {
      await expectAccepted(async (tx) => meter(tx, await mkRoom(tx), { retiredOn: new Date('2026-10-01') }));
      await expectRejected(async (tx) => meter(tx, await mkRoom(tx), { retiredOn: new Date('2026-09-30') }), 'meters_retired_after_installed_chk');
    },

    // ---------------- Phase 5 ----------------
    one_monthly_invoice_per_period: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const p = await period(tx, '2031-06-01');
        await invoice(tx, tn, { statementPeriodId: p, lifecycle: 'CANCELLED' });
        await invoice(tx, tn, { statementPeriodId: p, lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` });
        await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-07-01') });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const p = await period(tx, '2031-06-01');
        await invoice(tx, tn, { statementPeriodId: p, lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` });
        await invoice(tx, tn, { statementPeriodId: p });
      }, 'one_monthly_invoice_per_period');
    },
    one_draft_invoice_per_tenancy: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01') });
        await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-07-01'), lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01') });
        await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-07-01') });
      }, 'one_draft_invoice_per_tenancy');
    },
    one_final_invoice_per_tenancy: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await invoice(tx, tn, { type: 'FINAL', lifecycle: 'CANCELLED' });
        await invoice(tx, tn, { type: 'FINAL', lifecycle: 'PUBLISHED', number: `QT-P5-${++n}` });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await invoice(tx, tn, { type: 'FINAL', lifecycle: 'PUBLISHED', number: `QT-P5-${++n}` });
        await invoice(tx, tn, { type: 'FINAL' });
      }, 'one_final_invoice_per_tenancy');
    },
    invoices_amounts_chk: async () => {
      const mk = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
        invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { statementPeriodId: await period(tx, '2031-06-01'), ...extra });
      await expectAccepted((tx) => mk(tx, { subtotalVnd: 0n, totalVnd: 0n }));
      await expectAccepted((tx) => mk(tx, { subtotalVnd: 5n, totalVnd: 5n }));
      // Nháp được tạm âm (tách credit khi phát hành — D-023); chứng từ đã phát hành thì không.
      await expectAccepted((tx) => mk(tx, { subtotalVnd: -1n, totalVnd: -1n }));
      await expectRejected((tx) => mk(tx, { subtotalVnd: -1n, totalVnd: -1n, lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` }), 'invoices_amounts_chk');
      await expectRejected((tx) => mk(tx, { subtotalVnd: 5n, discountVnd: 1n, totalVnd: 4n }), 'invoices_amounts_chk');
      await expectRejected((tx) => mk(tx, { subtotalVnd: 5n, totalVnd: 4n }), 'invoices_amounts_chk');
    },
    invoices_published_chk: async () => {
      const mk = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
        invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { statementPeriodId: await period(tx, '2031-06-01'), ...extra });
      await expectAccepted((tx) => mk(tx, { lifecycle: 'PUBLISHED', number: `TB-P5-${++n}`, publishedAt: new Date() }));
      await expectAccepted((tx) => mk(tx, { lifecycle: 'CANCELLED' }));
      await expectRejected((tx) => mk(tx, { lifecycle: 'PUBLISHED' }), 'invoices_published_chk');
      await expectRejected((tx) => mk(tx, { lifecycle: 'CANCELLED', publishedAt: new Date() }), 'invoices_published_chk');
    },
    invoices_monthly_period_chk: async () => {
      await expectAccepted(async (tx) => invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { type: 'FINAL' }));
      await expectRejected(async (tx) => invoice(tx, await mkTenancy(tx, await mkRoom(tx)), {}), 'invoices_monthly_period_chk');
    },
    invoices_adjustment_chk: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const src = await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01'), lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` });
        await invoice(tx, tn, { type: 'CREDIT_ADJUSTMENT', lifecycle: 'PUBLISHED', number: `GC-P5-${++n}`, sourceInvoiceId: src.id });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const src = await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01'), lifecycle: 'PUBLISHED', number: `TB-P5-${++n}` });
        await invoice(tx, tn, { type: 'DEBIT_ADJUSTMENT', sourceInvoiceId: src.id });
      }, 'invoices_adjustment_chk');
      await expectRejected(
        async (tx) => invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { type: 'CREDIT_ADJUSTMENT', lifecycle: 'PUBLISHED', number: `GC-P5-${++n}` }),
        'invoices_adjustment_chk',
      );
    },
    invoice_items_amount_chk: async () => {
      await expectAccepted(async (tx) => item(tx, { amountVnd: 0n }));
      await expectRejected(async (tx) => item(tx, { amountVnd: -1n }), 'invoice_items_amount_chk');
    },
    invoice_items_period_chk: async () => {
      await expectAccepted(async (tx) => item(tx, { chargeStart: new Date('2026-10-31'), chargeEndExclusive: new Date('2026-11-01') }));
      await expectAccepted(async (tx) => item(tx, { chargeStart: null, chargeEndExclusive: null }));
      await expectRejected(async (tx) => item(tx, { chargeStart: new Date('2026-11-01'), chargeEndExclusive: new Date('2026-11-01') }), 'invoice_items_period_chk');
    },

    // ---------------- Phase 6 ----------------
    payments_amount_positive_chk: async () => {
      await expectAccepted(async (tx) => pay(tx, { amountVnd: 1n }));
      await expectRejected(async (tx) => pay(tx, { amountVnd: 0n }), 'payments_amount_positive_chk');
    },
    payment_allocations_amount_positive_chk: async () => {
      const alloc = async (tx: Prisma.TransactionClient, amountVnd: bigint) => {
        const p = await pay(tx, {});
        const inv = await invoice(tx, p.tenancyId, { statementPeriodId: await period(tx, '2031-06-01') });
        return tx.paymentAllocation.create({ data: { paymentId: p.id, invoiceId: inv.id, amountVnd } });
      };
      await expectAccepted((tx) => alloc(tx, 1n));
      await expectRejected((tx) => alloc(tx, 0n), 'payment_allocations_amount_positive_chk');
    },
    credit_applications_amount_positive_chk: async () => {
      await expectAccepted((tx) => creditApp(tx, { amountVnd: 1n }));
      await expectRejected((tx) => creditApp(tx, { amountVnd: 0n }), 'credit_applications_amount_positive_chk');
    },
    credit_refunds_amount_positive_chk: async () => {
      await expectAccepted((tx) => creditRefund(tx, { amountVnd: 1n }));
      await expectRejected((tx) => creditRefund(tx, { amountVnd: 0n }), 'credit_refunds_amount_positive_chk');
    },
    deposit_allocations_amount_positive_chk: async () => {
      const alloc = async (tx: Prisma.TransactionClient, amountVnd: bigint) => {
        const d = await deposit(tx, { type: 'RECEIVED' });
        const inv = await invoice(tx, d.tenancyId, { statementPeriodId: await period(tx, '2031-06-01') });
        return tx.depositAllocation.create({ data: { depositTransactionId: d.id, invoiceId: inv.id, amountVnd } });
      };
      await expectAccepted((tx) => alloc(tx, 1n));
      await expectRejected((tx) => alloc(tx, 0n), 'deposit_allocations_amount_positive_chk');
    },
    payments_reversal_chk: async () => {
      await expectAccepted((tx) => pay(tx, { status: 'REVERSED', reversedAt: new Date(), reversalReason: 'Ghi nhầm' }));
      await expectRejected((tx) => pay(tx, { status: 'REVERSED' }), 'payments_reversal_chk');
      await expectRejected((tx) => pay(tx, { reversedAt: new Date(), reversalReason: 'x' }), 'payments_reversal_chk');
    },
    credit_applications_reversal_chk: async () => {
      await expectAccepted((tx) => creditApp(tx, { status: 'REVERSED', reversedAt: new Date(), reversalReason: 'Ghi nhầm' }));
      await expectRejected((tx) => creditApp(tx, { status: 'REVERSED' }), 'credit_applications_reversal_chk');
    },
    credit_refunds_reversal_chk: async () => {
      await expectAccepted((tx) => creditRefund(tx, { status: 'REVERSED', reversedAt: new Date(), reversalReason: 'Ghi nhầm' }));
      await expectRejected((tx) => creditRefund(tx, { status: 'REVERSED' }), 'credit_refunds_reversal_chk');
    },
    one_active_payment_account: async () => {
      const acc = (tx: Prisma.TransactionClient, isActive: boolean) =>
        tx.paymentAccount.create({ data: { workspaceId: W, bankBin: '970436', bankName: 'VCB', accountNumber: '1', accountName: 'A', isActive, createdBy: userId } });
      await expectAccepted(async (tx) => {
        await tx.paymentAccount.updateMany({ where: { workspaceId: W }, data: { isActive: false } });
        await acc(tx, true);
        await acc(tx, false);
        await acc(tx, false);
      });
      await expectRejected(async (tx) => {
        await tx.paymentAccount.updateMany({ where: { workspaceId: W }, data: { isActive: false } });
        await acc(tx, true);
        await acc(tx, true);
      }, 'one_active_payment_account');
    },
    credit_applications_distinct_chk: async () => {
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        const src = await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01'), lifecycle: 'PUBLISHED', number: `TB-P6-${++n}` });
        const credit = await invoice(tx, tn, { type: 'CREDIT_ADJUSTMENT', lifecycle: 'PUBLISHED', number: `GC-P6-${++n}`, sourceInvoiceId: src.id });
        await tx.creditApplication.create({ data: { workspaceId: W, tenancyId: tn, creditInvoiceId: credit.id, targetInvoiceId: credit.id, amountVnd: 1n, createdBy: userId } });
      }, 'credit_applications_distinct_chk');
    },

    // ---------------- Phase 7 ----------------
    one_active_notice_per_tenancy: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await notice(tx, tn, { status: 'CANCELLED' });
        await notice(tx, tn, {});
        await notice(tx, tn, { status: 'FULFILLED' });
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await notice(tx, tn, {});
        await notice(tx, tn, {});
      }, 'one_active_notice_per_tenancy');
    },
    one_live_settlement_per_tenancy: async () => {
      await expectAccepted(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await settlement(tx, tn, { status: 'CANCELLED' });
        await settlement(tx, tn, {});
      });
      await expectRejected(async (tx) => {
        const tn = await mkTenancy(tx, await mkRoom(tx));
        await settlement(tx, tn, {});
        await settlement(tx, tn, {});
      }, 'one_live_settlement_per_tenancy');
    },
    move_out_notices_dates_chk: async () => {
      await expectAccepted(async (tx) => notice(tx, await mkTenancy(tx, await mkRoom(tx)), { noticeDate: new Date('2026-11-20'), plannedLastChargeDate: new Date('2026-11-20') }));
      await expectRejected(
        async (tx) => notice(tx, await mkTenancy(tx, await mkRoom(tx)), { noticeDate: new Date('2026-11-20'), plannedLastChargeDate: new Date('2026-11-19') }),
        'move_out_notices_dates_chk',
      );
    },
    move_out_settlements_dates_chk: async () => {
      await expectAccepted(async (tx) => settlement(tx, await mkTenancy(tx, await mkRoom(tx)), { lastChargeDate: new Date('2026-12-31'), chargeEndExclusive: new Date('2027-01-01') }));
      await expectRejected(
        async (tx) => settlement(tx, await mkTenancy(tx, await mkRoom(tx)), { lastChargeDate: new Date('2026-11-20'), chargeEndExclusive: new Date('2026-11-20') }),
        'move_out_settlements_dates_chk',
      );
    },
    move_out_settlements_workflow_chk: async () => {
      const mk = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => settlement(tx, await mkTenancy(tx, await mkRoom(tx)), extra);
      await expectAccepted((tx) => mk(tx, { status: 'APPROVED', approvedBy: userId, inputHash: 'h' }));
      await expectAccepted((tx) => mk(tx, { status: 'COMPLETED', approvedBy: userId, inputHash: 'h', completedAt: new Date() }));
      await expectRejected((tx) => mk(tx, { status: 'APPROVED' }), 'move_out_settlements_workflow_chk');
      await expectRejected((tx) => mk(tx, { status: 'COMPLETED', approvedBy: userId, inputHash: 'h' }), 'move_out_settlements_workflow_chk');
      await expectRejected((tx) => mk(tx, { completedAt: new Date() }), 'move_out_settlements_workflow_chk');
    },
    move_out_settlements_deposit_chk: async () => {
      await expectAccepted(async (tx) => settlement(tx, await mkTenancy(tx, await mkRoom(tx)), { depositToApplyVnd: 0n }));
      await expectRejected(async (tx) => settlement(tx, await mkTenancy(tx, await mkRoom(tx)), { depositToApplyVnd: -1n }), 'move_out_settlements_deposit_chk');
    },
    settlement_items_amount_chk: async () => {
      const item = async (tx: Prisma.TransactionClient, kind: string, amountVnd: bigint) => {
        const st = await settlement(tx, await mkTenancy(tx, await mkRoom(tx)), {});
        return tx.settlementItem.create({ data: { settlementId: st.id, kind, amountVnd, reason: 'x' } as never });
      };
      await expectAccepted((tx) => item(tx, 'DAMAGE', 1n));
      await expectAccepted((tx) => item(tx, 'INVOICE_BALANCE', 0n));
      await expectRejected((tx) => item(tx, 'DAMAGE', 0n), 'settlement_items_amount_chk');
      await expectRejected((tx) => item(tx, 'INVOICE_BALANCE', -1n), 'settlement_items_amount_chk');
    },

    // ---------------- Phase 8B ----------------
    reminder_settings_hours_chk: async () => {
      const mk = (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
        tx.reminderSettings.upsert({ where: { workspaceId: W }, update: extra, create: { workspaceId: W, ...extra } as never });
      await expectAccepted((tx) => mk(tx, { sendHour: 23, quietStart: 0, quietEnd: 23 }));
      await expectRejected((tx) => mk(tx, { sendHour: 24 }), 'reminder_settings_hours_chk');
      await expectRejected((tx) => mk(tx, { quietEnd: -1 }), 'reminder_settings_hours_chk');
    },
    reminder_messages_state_chk: async () => {
      const msg = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
        const inv = await invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { statementPeriodId: await period(tx, '2031-06-01') });
        return tx.reminderMessage.create({
          data: { workspaceId: W, invoiceId: inv.id, tenantId: await mkTenant(tx), milestone: 'DUE', offsetDays: 0, scheduledFor: new Date(), recipientMasked: '09******89', contentSnapshot: {}, ...extra } as never,
        });
      };
      await expectAccepted((tx) => msg(tx, { status: 'SENT', sentAt: new Date(), channelUsed: 'LOG_ONLY' }));
      await expectAccepted((tx) => msg(tx, { status: 'SKIPPED', skipReason: 'PAID' }));
      await expectRejected((tx) => msg(tx, { status: 'SENT' }), 'reminder_messages_state_chk');
      await expectRejected((tx) => msg(tx, { status: 'SKIPPED' }), 'reminder_messages_state_chk');
      await expectRejected((tx) => msg(tx, { attemptCount: -1 }), 'reminder_messages_state_chk');
    },

    // ---------------- Phase 11 ----------------
    statement_periods_closed_chk: async () => {
      const close = async (tx: Prisma.TransactionClient, closedAt: Date | null) =>
        tx.statementPeriod.update({ where: { id: await period(tx, '2031-08-01') }, data: { status: 'CLOSED', closedAt } });
      await expectAccepted((tx) => close(tx, new Date()));
      await expectRejected((tx) => close(tx, null), 'statement_periods_closed_chk');
      await expectRejected(
        async (tx) => tx.statementPeriod.update({ where: { id: await period(tx, '2031-09-01') }, data: { closedAt: new Date() } }),
        'statement_periods_closed_chk',
      );
    },
    contract_revisions_no_chk: async () => {
      const rev = async (tx: Prisma.TransactionClient, revisionNo: number) => {
        const c = await contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-01', '2027-03-31', { lifecycle: 'SIGNED', signedAt: new Date('2026-10-01') });
        return tx.contractRevision.create({
          data: { contractId: c.id, revisionNo, effectiveFrom: new Date('2026-11-01'), changes: {}, termsBefore: {}, termsAfter: {}, reason: 'x', createdBy: userId },
        });
      };
      await expectAccepted((tx) => rev(tx, 1));
      await expectRejected((tx) => rev(tx, 0), 'contract_revisions_no_chk');
    },
    contract_alerts_milestone_chk: async () => {
      const alert = async (tx: Prisma.TransactionClient, milestoneDays: number) => {
        const c = await contract(tx, await mkTenancy(tx, await mkRoom(tx)), '2026-10-01', '2027-03-31');
        return tx.contractAlert.create({ data: { workspaceId: W, contractId: c.id, termEnd: new Date('2027-03-31'), milestoneDays } });
      };
      await expectAccepted((tx) => alert(tx, 1));
      await expectRejected((tx) => alert(tx, 0), 'contract_alerts_milestone_chk');
    },

    // ---------------- Phase 12 ----------------
    expenses_amount_chk: async () => {
      await expectAccepted((tx) => expense(tx, { amountVnd: 1n }));
      await expectRejected((tx) => expense(tx, { amountVnd: 0n }), 'expenses_amount_chk');
    },
    expenses_state_chk: async () => {
      await expectAccepted((tx) => expense(tx, { status: 'REVERSED', reversedAt: new Date(), reverseReason: 'Nhập nhầm' }));
      await expectRejected((tx) => expense(tx, { status: 'REVERSED', reversedAt: new Date() }), 'expenses_state_chk');
      await expectRejected((tx) => expense(tx, { reverseReason: 'x', reversedAt: new Date() }), 'expenses_state_chk');
    },
    expenses_room_building_chk: async () => {
      await expectAccepted(async (tx) => expense(tx, { buildingId: SEED_IDS.buildings.A, roomId: await mkRoom(tx) }));
      await expectRejected(async (tx) => expense(tx, { roomId: await mkRoom(tx) }), 'expenses_room_building_chk');
    },

    // ---------------- Phase 13 ----------------
    files_size_chk: async () => {
      await expectAccepted((tx) => file(tx, { sizeBytes: 10485760 }));
      await expectRejected((tx) => file(tx, { sizeBytes: 0 }), 'files_size_chk');
      await expectRejected((tx) => file(tx, { sizeBytes: 10485761 }), 'files_size_chk');
      await expectRejected((tx) => file(tx, { sha256: 'xyz' }), 'files_size_chk');
    },
    files_archive_chk: async () => {
      await expectAccepted((tx) => file(tx, { archivedAt: new Date(), archiveReason: 'Tải nhầm' }));
      await expectRejected((tx) => file(tx, { archivedAt: new Date() }), 'files_archive_chk');
    },
    maintenance_resolved_chk: async () => {
      await expectAccepted(async (tx) => maintenance(tx, { status: 'DONE', resolvedAt: new Date() }));
      await expectRejected(async (tx) => maintenance(tx, { status: 'DONE' }), 'maintenance_resolved_chk');
      await expectRejected(async (tx) => maintenance(tx, { status: 'OPEN', resolvedAt: new Date() }), 'maintenance_resolved_chk');
    },

    // ---------------- Phase 14 ----------------
    room_transfers_deposit_chk: async () => {
      const mk = async (tx: Prisma.TransactionClient, amount: bigint, withPair: boolean, onlyOut = false) => {
        const from = await mkTenancy(tx, await mkRoom(tx), { status: 'ENDED' });
        const to = await mkTenancy(tx, await mkRoom(tx));
        let outId: string | null = null;
        let inId: string | null = null;
        if (withPair) {
          const out = await tx.depositTransaction.create({ data: { workspaceId: W, tenancyId: from, type: 'TRANSFER_OUT', amountVnd: amount || 1n, createdBy: userId } });
          const inn = await tx.depositTransaction.create({ data: { workspaceId: W, tenancyId: to, type: 'TRANSFER_IN', amountVnd: amount || 1n, linkedDepositTransactionId: out.id, createdBy: userId } });
          outId = out.id;
          inId = onlyOut ? null : inn.id;
        }
        return tx.roomTransfer.create({
          data: { workspaceId: W, fromTenancyId: from, toTenancyId: to, transferDate: new Date('2026-11-01'), depositAmountVnd: amount, depositTransferOutId: outId, depositTransferInId: inId, createdBy: userId },
        });
      };
      await expectAccepted((tx) => mk(tx, 0n, false));
      await expectAccepted((tx) => mk(tx, 500000n, true));
      await expectRejected((tx) => mk(tx, 500000n, false), 'room_transfers_deposit_chk');
      await expectRejected((tx) => mk(tx, 0n, true), 'room_transfers_deposit_chk');
      await expectRejected((tx) => mk(tx, 500000n, true, true), 'room_transfers_deposit_chk');
      await expectRejected((tx) => mk(tx, -1n, false), 'room_transfers_deposit_chk');
    },
    room_transfers_distinct_chk: async () => {
      await expectRejected(async (tx) => {
        const t = await mkTenancy(tx, await mkRoom(tx));
        return tx.roomTransfer.create({ data: { workspaceId: W, fromTenancyId: t, toTenancyId: t, transferDate: new Date('2026-11-01'), createdBy: userId } });
      }, 'room_transfers_distinct_chk');
    },
  } satisfies Record<string, () => Promise<void>>);

  const price = (tx: Prisma.TransactionClient, serviceId: string, buildingId: string | null, from: string, unitPrice = '1000') =>
    tx.servicePriceHistory.create({ data: { workspaceId: W, serviceId, buildingId, effectiveFrom: new Date(from), unitPrice, createdBy: userId } });
  const period = async (tx: Prisma.TransactionClient, monthStart: string) =>
    (await tx.statementPeriod.upsert({ where: { workspaceId_monthStart: { workspaceId: W, monthStart: new Date(monthStart) } }, update: {}, create: { workspaceId: W, monthStart: new Date(monthStart) } })).id;

  const invoice = (tx: Prisma.TransactionClient, tenancyId: string, extra: Record<string, unknown>) =>
    tx.invoice.create({
      data: { workspaceId: W, tenancyId, type: 'MONTHLY', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-05'), createdBy: userId, ...extra } as never,
    });
  const item = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
    const inv = await invoice(tx, await mkTenancy(tx, await mkRoom(tx)), { statementPeriodId: await period(tx, '2031-06-01') });
    return tx.invoiceItem.create({
      data: {
        invoiceId: inv.id,
        chargeKind: 'RENT',
        chargeTiming: 'ADVANCE',
        direction: 'DEBIT',
        labelSnapshot: 'x',
        quantity: '1',
        unitPrice: '1',
        amountVnd: 1n,
        sourceType: 'RENT',
        sourceKey: 'RENT:x',
        unitKey: 'RENT:x:2031-06',
        policySnapshot: {},
        calculationSnapshot: {},
        ...extra,
      } as never,
    });
  };

  const pay = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
    tx.payment.create({
      data: { workspaceId: W, tenancyId: await mkTenancy(tx, await mkRoom(tx)), number: `PT-P6-${++n}`, amountVnd: 1n, method: 'CASH', paidAt: new Date('2026-10-01'), createdBy: userId, ...extra } as never,
    });
  const creditPair = async (tx: Prisma.TransactionClient) => {
    const tn = await mkTenancy(tx, await mkRoom(tx));
    const src = await invoice(tx, tn, { statementPeriodId: await period(tx, '2031-06-01'), lifecycle: 'PUBLISHED', number: `TB-P6-${++n}` });
    const credit = await invoice(tx, tn, { type: 'CREDIT_ADJUSTMENT', lifecycle: 'PUBLISHED', number: `GC-P6-${++n}`, sourceInvoiceId: src.id });
    return { tn, src, credit };
  };
  const creditApp = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
    const { tn, src, credit } = await creditPair(tx);
    return tx.creditApplication.create({ data: { workspaceId: W, tenancyId: tn, creditInvoiceId: credit.id, targetInvoiceId: src.id, amountVnd: 1n, createdBy: userId, ...extra } as never });
  };
  const creditRefund = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) => {
    const { tn, credit } = await creditPair(tx);
    return tx.creditRefund.create({
      data: { workspaceId: W, tenancyId: tn, creditInvoiceId: credit.id, amountVnd: 1n, paidAt: new Date('2026-10-01'), method: 'CASH', createdBy: userId, ...extra } as never,
    });
  };

  const notice = (tx: Prisma.TransactionClient, tenancyId: string, extra: Record<string, unknown>) =>
    tx.moveOutNotice.create({
      data: { workspaceId: W, tenancyId, noticeDate: new Date('2026-11-01'), plannedLastChargeDate: new Date('2026-11-30'), createdBy: userId, ...extra } as never,
    });
  const settlement = (tx: Prisma.TransactionClient, tenancyId: string, extra: Record<string, unknown>) =>
    tx.moveOutSettlement.create({
      data: {
        workspaceId: W,
        tenancyId,
        code: `QT-P7-${++n}`,
        lastChargeDate: new Date('2026-11-20'),
        chargeEndExclusive: new Date('2026-11-21'),
        destinationRoomStatus: 'READY',
        createdBy: userId,
        ...extra,
      } as never,
    });

  let fseq = 0;
  const file = (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
    tx.storedFile.create({
      data: {
        workspaceId: W,
        storageKey: `t47/${++fseq}`,
        originalName: 'a.jpg',
        mime: 'image/jpeg',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        category: 'OTHER',
        ownerEntityType: 'tenant',
        ownerEntityId: W,
        uploadedBy: userId,
        ...extra,
      } as never,
    });
  const maintenance = async (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
    tx.maintenanceRequest.create({ data: { workspaceId: W, code: `BT-T47-${++fseq}`, roomId: await mkRoom(tx), title: 'Hỏng vòi', createdBy: userId, ...extra } as never });

  let eseq = 0;
  const expense = (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
    tx.expense.create({
      data: { workspaceId: W, number: `PC-T47-${++eseq}`, category: 'REPAIR', amountVnd: 100000n, spentOn: new Date('2026-10-01'), method: 'CASH', createdBy: userId, ...extra } as never,
    });

  let cseq = 0;
  async function contract(tx: Prisma.TransactionClient, tenancyId: string, start: string, end: string, extra: Record<string, unknown> = {}) {
    return tx.contract.create({
      data: { workspaceId: W, tenancyId, code: `C${++cseq}`, termStart: new Date(start), termEnd: new Date(end), termsSnapshot: {}, createdBy: userId, ...extra } as never,
    });
  }

  let roomSeq = 0;
  function insertRoom(opts: { rent?: number; maxOccupants?: number }) {
    return (tx: Prisma.TransactionClient) =>
      tx.$executeRawUnsafe(
        `INSERT INTO rooms (id, workspace_id, building_id, code, default_rent_vnd, max_occupants, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, now())`,
        SEED_IDS.workspace,
        SEED_IDS.buildings.A,
        `CHK${++roomSeq}`,
        opts.rent ?? 1000,
        opts.maxOccupants ?? 2,
      );
  }
  async function roomInTx(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO rooms (id, workspace_id, building_id, code, default_rent_vnd, max_occupants, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 1000, 2, now()) RETURNING id::text`,
      SEED_IDS.workspace,
      SEED_IDS.buildings.A,
      `RSV${++roomSeq}`,
    );
    return rows[0]!.id;
  }
  function insertReservation(tx: Prisma.TransactionClient, roomId: string, from: string, moveIn: string, until: string, status = 'ACTIVE') {
    return tx.$executeRawUnsafe(
      `INSERT INTO reservations (id, workspace_id, room_id, hold_from, expected_move_in, hold_until, status, contact_name, created_by, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::date, $4::date, $5::date, $6::"ReservationStatus", 'Probe', $7::uuid, now())`,
      SEED_IDS.workspace,
      roomId,
      from,
      moveIn,
      until,
      status,
      userId,
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
    userId = (await t.prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
  });
  afterAll(() => t.close());

  it('danh mục không rỗng và mọi ràng buộc đều có test hành vi', () => {
    expect(catalog.length).toBeGreaterThan(0);
    const missing = catalog.map((c) => c.name).filter((name) => !behaviours[name]);
    expect(missing, 'ràng buộc chưa có test hành vi').toEqual([]);
  });

  for (const entry of catalog) {
    it(`định nghĩa khớp danh mục: ${entry.name}`, async () => {
      if (entry.kind === 'function') {
        const rows = await t.prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, entry.definition);
        expect(rows[0]?.ok).toBe(true);
        return;
      }
      if (entry.kind === 'extension') {
        const rows = await t.prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = ${entry.definition}`;
        expect(rows).toHaveLength(1);
        return;
      }
      if (entry.kind === 'index') {
        const rows = await t.prisma.$queryRaw<{ def: string }[]>`
          SELECT pg_get_indexdef(c.oid) AS def FROM pg_class c WHERE c.relname = ${entry.name} AND c.relkind = 'i'`;
        expect(rows[0]?.def).toBe(entry.definition);
        return;
      }
      const rows = await t.prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = ${entry.name} AND conrelid = ${entry.table}::regclass`;
      expect(rows[0]?.def).toBe(entry.definition);
    });

    it(`hành vi đúng: ${entry.name}`, async () => {
      const behaviour = behaviours[entry.name];
      if (!behaviour) throw new Error(`Chưa có test hành vi cho ${entry.name}`);
      await behaviour();
    });
  }
});
