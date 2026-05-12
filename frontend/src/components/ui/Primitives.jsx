import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Search,
  XCircle,
} from './Icons';
import { forwardRef } from 'react';

const toneMap = {
  default: 'border-surface-700 bg-surface-900/80 text-surface-100',
  subtle: 'border-surface-800 bg-surface-950/40 text-surface-300',
  accent: 'border-accent/35 bg-accent/10 text-accent-soft',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
  danger: 'border-red-500/25 bg-red-500/10 text-red-200',
};

const variantMap = {
  primary: 'border-accent bg-accent text-white hover:bg-accent-dim hover:border-accent-dim',
  secondary: 'border-surface-700 bg-surface-800 text-surface-100 hover:bg-surface-700',
  ghost: 'border-transparent bg-transparent text-surface-300 hover:bg-surface-800 hover:text-white',
  outline: 'border-surface-700 bg-transparent text-surface-200 hover:border-surface-600 hover:bg-surface-850',
  danger: 'border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/18',
};

export function cx(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}

export function Button({
  children,
  as: Component = 'button',
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  className = '',
  type = 'button',
  ...props
}) {
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-3.5 text-sm',
    lg: 'h-10 px-4 text-sm',
  };
  return (
    <Component
      type={Component === 'button' ? type : undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-medium',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantMap[variant] || variantMap.secondary,
        sizes[size] || sizes.md,
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </Component>
  );
}

export function IconButton({ label, icon: Icon, className = '', variant = 'ghost', ...props }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      className={cx('h-8 w-8 px-0', className)}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export function FieldLabel({ children, htmlFor, className = '' }) {
  if (!children) return null;
  return (
    <label htmlFor={htmlFor} className={cx('mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-surface-500', className)}>
      {children}
    </label>
  );
}

export const Input = forwardRef(function Input({ icon: Icon, label, id, className = '', inputClassName = '', ...props }, ref) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />}
        <input
          ref={ref}
          id={id}
          className={cx(
            'h-9 w-full rounded-lg border border-surface-700 bg-surface-950 px-3 text-sm text-surface-100',
            'placeholder:text-surface-500 transition-colors focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15',
            'disabled:cursor-not-allowed disabled:opacity-60',
            Icon && 'pl-9',
            inputClassName
          )}
          {...props}
        />
      </div>
    </div>
  );
});

export function SearchInput(props) {
  return <Input icon={Search} {...props} />;
}

export function Textarea({ label, id, className = '', inputClassName = '', ...props }) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        className={cx(
          'min-h-28 w-full rounded-lg border border-surface-700 bg-surface-950 px-3 py-2.5 text-sm text-surface-100',
          'placeholder:text-surface-500 transition-colors focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15',
          'disabled:cursor-not-allowed disabled:opacity-60',
          inputClassName
        )}
        {...props}
      />
    </div>
  );
}

export function CodeTextarea({ inputClassName = '', ...props }) {
  return (
    <Textarea
      inputClassName={cx('font-mono leading-6 tabular-nums', inputClassName)}
      {...props}
    />
  );
}

export function Select({ label, id, className = '', inputClassName = '', children, ...props }) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        className={cx(
          'h-9 w-full rounded-lg border border-surface-700 bg-surface-950 px-3 text-sm text-surface-200',
          'transition-colors focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15',
          inputClassName
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export function Badge({ children, tone = 'default', className = '' }) {
  return (
    <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', toneMap[tone] || toneMap.default, className)}>
      {children}
    </span>
  );
}

export function Panel({ children, as: Component = 'section', className = '', padded = true, tone = 'default', ...props }) {
  return (
    <Component
      className={cx('rounded-xl border shadow-panel', toneMap[tone] || toneMap.default, padded && 'p-5', className)}
      {...props}
    >
      {children}
    </Component>
  );
}

export function Toolbar({ children, className = '' }) {
  return <div className={cx('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export function ActionRow({ children, className = '' }) {
  return <div className={cx('flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end', className)}>{children}</div>;
}

export function SegmentedControl({ options, value, onChange, className = '', label }) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      <div className="inline-flex rounded-lg border border-surface-700 bg-surface-950 p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange?.(option.value)}
              className={cx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                selected ? 'bg-accent text-white' : 'text-surface-400 hover:bg-surface-800 hover:text-surface-100'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Banner({ children, tone = 'accent', icon: Icon, className = '' }) {
  const DefaultIcon = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  const ActualIcon = Icon || DefaultIcon;
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', toneMap[tone] || toneMap.accent, className)}>
      <ActualIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, actions, className = '' }) {
  return (
    <div className={cx('flex min-h-[20rem] flex-col items-center justify-center rounded-xl border border-dashed border-surface-700 bg-surface-900/35 p-8 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-surface-700 bg-surface-850 text-surface-300">
        <Icon className="h-5 w-5" />
      </div>
      {title && <h3 className="text-base font-semibold text-surface-100">{title}</h3>}
      {description && <p className="mt-1 max-w-md text-sm leading-relaxed text-surface-400">{description}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={cx('skeleton', className)} />;
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-surface-700 bg-surface-800'
      )}
    >
      <span className={cx('h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

export function LoadingMark({ label = 'Loading', detail }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app-bg text-surface-100">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
        <div className="absolute h-9 w-9 rounded-full border border-accent/25" />
        <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="font-mono text-sm font-medium text-surface-300">{label}</p>
        {detail && <p className="mt-1 text-xs text-surface-500">{detail}</p>}
      </div>
    </div>
  );
}
