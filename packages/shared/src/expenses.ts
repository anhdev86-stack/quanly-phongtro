import { z } from 'zod';
import { optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';

// V1.1 Phase 12: chi phí vận hành (MASTER_PLAN 6.7, 13).

export const EXPENSE_CATEGORIES = ['REPAIR', 'UTILITY_BILL', 'CLEANING', 'INTERNET', 'SALARY', 'SUPPLIES', 'TAX_FEE', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  REPAIR: 'Sửa chữa, bảo trì',
  UTILITY_BILL: 'Hóa đơn điện, nước tổng',
  CLEANING: 'Vệ sinh, rác',
  INTERNET: 'Internet, truyền hình',
  SALARY: 'Lương, công',
  SUPPLIES: 'Vật tư, đồ dùng',
  TAX_FEE: 'Thuế, phí, lệ phí',
  OTHER: 'Khác',
};

export const expenseCreateSchema = z.strictObject({
  /** Bỏ trống = chi chung cả nhà trọ (cần phạm vi mọi tòa). */
  building_id: uuidSchema.nullish().transform((v) => v ?? null),
  room_id: uuidSchema.nullish().transform((v) => v ?? null),
  category: z.enum(EXPENSE_CATEGORIES),
  amount_vnd: moneyVndSchema.refine((v) => v !== '0', 'Số tiền phải lớn hơn 0.'),
  spent_on: businessDateSchema,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'OTHER']),
  payee: optionalText(200),
  note: optionalText(1000),
});

export const expenseReverseSchema = z.strictObject({ reason: reasonSchema });

export const expenseListQuerySchema = pageQuerySchema.extend({
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  building_id: uuidSchema.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  status: z.enum(['POSTED', 'REVERSED']).optional(),
});

export const expenseSchema = z.object({
  id: z.string(),
  number: z.string(),
  building_id: z.string().nullable(),
  building_code: z.string().nullable(),
  room_id: z.string().nullable(),
  room_code: z.string().nullable(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount_vnd: z.string(),
  spent_on: z.string(),
  method: z.string(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['POSTED', 'REVERSED']),
  reversed_at: z.string().nullable(),
  reverse_reason: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;
