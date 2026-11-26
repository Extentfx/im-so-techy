import { useId } from 'react';

const inputCls =
  'min-h-11 w-full rounded-2xl border border-white/20 bg-white/10 px-4 text-base text-inherit placeholder:text-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} className={inputCls} {...props} />
      {hint && <span className="text-xs text-[var(--ink-soft)]">{hint}</span>}
    </div>
  );
}

/** Single choice. Radios under the hood so keyboard and screen readers behave. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="chip" data-on={o.value === value}>
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Multiple choice, with an optional exclusive "none" value. */
export function Multi<T extends string>({
  label,
  value,
  options,
  onChange,
  none,
}: {
  label: string;
  value: T[];
  options: { value: T; label: string }[];
  onChange: (v: T[]) => void;
  none?: T;
}) {
  const toggle = (v: T) => {
    if (v === none) return onChange(value.includes(v) ? [] : [v]);
    const next = value.includes(v)
      ? value.filter((x) => x !== v)
      : [...value.filter((x) => x !== none), v];
    onChange(next);
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="chip" data-on={value.includes(o.value)}>
            <input
              type="checkbox"
              className="sr-only"
              checked={value.includes(o.value)}
              onChange={() => toggle(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
