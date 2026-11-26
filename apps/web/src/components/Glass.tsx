import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function GlassCard({
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  return <section className={cx('glass rounded-3xl p-5', className)} {...rest} />;
}

export function GlassButton({
  className,
  variant = 'soft',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'soft' | 'solid' }) {
  return (
    <button
      type="button"
      className={cx(
        'min-h-11 min-w-11 rounded-full px-5 text-sm font-medium transition active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        variant === 'soft' ? 'glass' : 'bg-[var(--accent)] text-white shadow-lg',
        className,
      )}
      {...rest}
    />
  );
}
