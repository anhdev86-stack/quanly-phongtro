'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequest } from '@ql-tro/shared';
import { BarChart3, BedDouble, Building2, Loader2, type LucideIcon, Zap } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useLogin } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

const FEATURES: { label: string; Icon: LucideIcon }[] = [
  { label: 'Phòng & người thuê', Icon: BedDouble },
  { label: 'Điện nước & thu tiền', Icon: Zap },
  { label: 'Báo cáo & công nợ', Icon: BarChart3 },
];

const SLOGAN_LINE_1 = 'Chuẩn hóa từng phòng,';
const SLOGAN_LINE_2 = 'an tâm mỗi tháng';
const INTRO = 'Theo dõi phòng, hợp đồng, điện nước và công nợ trong một nơi.';

/**
 * Đăng nhập: máy tính chia hai cột (giới thiệu 55% nền mint, form 45% nền trắng);
 * dưới 1024px chỉ còn dải giới thiệu gọn phía trên và form.
 */
export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => router.replace('/'),
    }),
  );

  const apiError = login.error instanceof ApiError ? login.error : login.error ? new ApiError(0, 'UNKNOWN', 'Đã có lỗi xảy ra.') : null;
  const { errors } = form.formState;

  return (
    <main className="flex min-h-full flex-col bg-white lg:grid lg:grid-cols-[55fr_45fr]">
      {/* Giới thiệu — máy tính */}
      <section className="hidden flex-col justify-center gap-8 bg-brand-50 px-12 py-12 lg:flex xl:px-20">
        <BrandMark />
        <div className="flex flex-col gap-4">
          <p className="text-4xl leading-tight font-semibold tracking-tight text-heading xl:text-[44px]">
            {SLOGAN_LINE_1}
            <br />
            <span className="text-brand-700">{SLOGAN_LINE_2}</span>
          </p>
          <p className="max-w-lg text-base text-slate-600">{INTRO}</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-[0_8px_24px_-12px_rgb(6_78_59/0.25)]">
          {/* Ảnh do chủ dự án cung cấp (10/10/2026). */}
          <Image
            src="/images/login-boarding-house.webp"
            alt="Dãy nhà trọ hiện đại, lối đi sạch sẽ, nhiều cây xanh và ánh nắng tự nhiên"
            width={1860}
            height={846}
            sizes="(min-width: 1024px) 50vw, 1px"
            loading="eager"
            className="aspect-[16/9] h-auto w-full object-cover"
          />
        </div>
        <ul className="grid grid-cols-3 gap-4">
          {FEATURES.map(({ label, Icon }) => (
            <li key={label} className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-brand-100">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-medium text-heading">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Giới thiệu gọn — điện thoại, máy tính bảng */}
      <section className="flex flex-col gap-3 bg-brand-50 px-5 pt-8 pb-6 sm:px-8 lg:hidden">
        <BrandMark />
        <p className="text-xl leading-snug font-semibold tracking-tight text-heading">
          {SLOGAN_LINE_1}
          <br />
          <span className="text-brand-700">{SLOGAN_LINE_2}</span>
        </p>
        <p className="text-sm text-slate-600">{INTRO}</p>
      </section>

      {/* Form */}
      <section className="flex flex-1 items-start justify-center px-5 py-10 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[26px] font-semibold tracking-tight text-heading lg:text-[28px]">Chào mừng trở lại</h1>
          <p className="mt-2 text-sm text-muted">Đăng nhập để quản lý nhà trọ của bạn.</p>

          {/* method="post": nếu JS chưa chạy, trình duyệt không đưa mật khẩu lên URL. */}
          <form method="post" onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
            {apiError ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {apiError.message}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="ten@vidu.com"
                className="h-12 rounded-lg border-line px-4 text-[15px]"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...form.register('email')}
              />
              {errors.email ? (
                <p id="email-error" className="text-xs text-red-600">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-12 rounded-lg border-line px-4 text-[15px]"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...form.register('password')}
              />
              {errors.password ? (
                <p id="password-error" className="text-xs text-red-600">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={login.isPending}
              className="mt-1 h-12 w-full bg-brand-700 text-[15px] font-semibold text-white hover:bg-brand-800 hover:text-white"
            >
              {login.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-700 text-white">
        <Building2 className="size-5" aria-hidden />
      </span>
      <span className="text-lg font-semibold text-heading">Quản lý nhà trọ</span>
    </div>
  );
}
