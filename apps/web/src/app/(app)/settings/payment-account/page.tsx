'use client';

import { type PaymentAccountDto, VN_BANKS } from '@ql-tro/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { usePaymentAccount, useSavePaymentAccount } from '@/features/payments/api';
import { ApiError } from '@/lib/api-client';

export default function PaymentAccountPage() {
  const account = usePaymentAccount();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        back={{ href: '/settings', label: 'Cấu hình' }}
        title="Tài khoản nhận tiền (VietQR)"
        description="Một tài khoản cho cả nhà trọ. Mã QR trên thông báo dùng tài khoản này; khách quét và chuyển khoản, bạn ghi nhận thu khi thấy tiền vào."
      />
      {account.isPending ? (
        <LoadingState />
      ) : account.isError ? (
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      ) : (
        <AccountForm key={account.data?.id ?? 'new'} current={account.data} />
      )}
    </div>
  );
}

function AccountForm({ current }: { current: PaymentAccountDto | null }) {
  const toast = useToast();
  const save = useSavePaymentAccount();
  const [v, setV] = useState({ bank_bin: current?.bank_bin ?? '', account_number: current?.account_number ?? '', account_name: current?.account_name ?? '' });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      await save.mutateAsync({ ...v, ...(current ? { expected_version: current.version } : {}) });
      toast.success('Đã lưu tài khoản nhận tiền.');
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    }
  };
  return (
    <>
      {current?.is_demo ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Đang dùng <strong>tài khoản demo</strong> ({current.bank_name} {current.account_number}) — QR chỉ để thử, không chuyển tiền thật. Nhập tài khoản thật của bạn bên dưới.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{current ? 'Thay tài khoản' : 'Thiết lập tài khoản'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormError message={error} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="pa-bank" label="Ngân hàng" required error={fe.bank_bin?.[0]}>
              <Select id="pa-bank" value={v.bank_bin} onChange={(e) => setV({ ...v, bank_bin: e.target.value })}>
                <option value="">— Chọn ngân hàng —</option>
                {VN_BANKS.map((b) => (
                  <option key={b.bin} value={b.bin}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="pa-number" label="Số tài khoản" required error={fe.account_number?.[0]}>
              <TextInput id="pa-number" inputMode="numeric" value={v.account_number} onChange={(e) => setV({ ...v, account_number: e.target.value.replace(/\s/g, '') })} />
            </Field>
            <Field id="pa-name" label="Tên chủ tài khoản" required className="sm:col-span-2" hint="Tự chuyển thành chữ hoa không dấu như trên app ngân hàng." error={fe.account_name?.[0]}>
              <TextInput id="pa-name" value={v.account_name} onChange={(e) => setV({ ...v, account_name: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={save.isPending}>
              Lưu tài khoản
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Khi có tài khoản thật: tạo một thông báo thử, quét QR bằng app ngân hàng để kiểm tra tên người nhận và số tiền trước khi gửi khách (kiểm tay một lần theo T57).
          </p>
        </CardContent>
      </Card>
      {current ? (
        <Card>
          <CardContent className="text-sm">
            <span>
              Đang dùng: <strong>{current.bank_name}</strong> · {current.account_number} · {current.account_name}
            </span>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
