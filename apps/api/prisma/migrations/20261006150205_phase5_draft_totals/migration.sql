-- Nháp có thể tạm có tổng âm (credit nhiều hơn phí); khi phát hành, dòng CREDIT được tách sang CREDIT_ADJUSTMENT (D-023)
-- nên chứng từ đã phát hành/hủy vẫn luôn có tổng ≥ 0. Nới invoices_amounts_chk cho trạng thái DRAFT.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amounts_chk";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_chk" CHECK (("lifecycle" = 'DRAFT' OR ("subtotal_vnd" >= 0 AND "total_vnd" >= 0)) AND "discount_vnd" = 0 AND "total_vnd" = "subtotal_vnd" - "discount_vnd");
