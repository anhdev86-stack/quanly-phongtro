import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// Thành phần theo phong cách shadcn/ui, viết tay (xem DECISIONS D-011).
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary #10B981: chữ xanh rất đậm (tương phản ~7:1); hover #059669 chữ trắng.
        default: 'bg-brand-500 font-semibold text-brand-950 hover:bg-brand-600 hover:text-white',
        outline: 'border border-line bg-white text-heading hover:bg-slate-50',
        ghost: 'text-slate-700 hover:bg-slate-100',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
