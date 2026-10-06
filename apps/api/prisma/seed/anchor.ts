/**
 * Mọi ngày trong dữ liệu demo được tính tương đối từ anchor date này (MASTER_PLAN mục 15),
 * để seed và test cho kết quả cố định. Đổi bằng biến môi trường SEED_ANCHOR_DATE (YYYY-MM-DD).
 */
export const SEED_ANCHOR_DATE = process.env.SEED_ANCHOR_DATE ?? '2026-10-01';
