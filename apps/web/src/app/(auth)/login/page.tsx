'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequest } from '@ql-tro/shared';
import { Building2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useLogin } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

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
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Building2 className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Quản lý nhà trọ</h1>
          <p className="text-sm text-slate-500">Đăng nhập để tiếp tục</p>
        </div>

        <Card>
          <CardContent className="py-6">
            {/* method="post": nếu JS chưa chạy, trình duyệt không đưa mật khẩu lên URL. */}
            <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {apiError ? (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {apiError.message}
                </p>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Mật khẩu</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
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

              <Button type="submit" disabled={login.isPending} className="mt-2 w-full">
                {login.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
