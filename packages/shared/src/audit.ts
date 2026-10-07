import { z } from 'zod';
import { pageQuerySchema } from './common.js';
import { businessDateSchema, uuidSchema } from './primitives.js';

// V1.1 Phase 10: tra cứu nhật ký thao tác (GET /audit-logs).

export const auditListQuerySchema = pageQuerySchema.extend({
  category: z.enum(['OPERATIONS', 'FINANCE', 'SYSTEM']).optional(),
  building_id: uuidSchema.optional(),
  actor_id: uuidSchema.optional(),
  entity_type: z.string().trim().max(50).optional(),
  entity_id: z.string().trim().max(64).optional(),
  /** Tìm theo mã thao tác, VD `payment` hoặc `invoice.publish`. */
  action: z.string().trim().max(80).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});

export const auditLogSchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  category: z.enum(['OPERATIONS', 'FINANCE', 'SYSTEM']),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  building_code: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  request_id: z.string().nullable(),
});
export type AuditLogDto = z.infer<typeof auditLogSchema>;
