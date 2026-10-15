import { cn } from "@/lib/utils";

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
  errors?: string[];
  className?: string;
  children?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">;

/** Label + input + inline validation message, wired up for accessibility. */
export function Field({ label, name, hint, errors, className, children, id, ...inputProps }: FieldProps) {
  const fieldId = id ?? `f-${name}`;
  const error = errors?.[0];
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={fieldId} className="block text-[13px] font-medium text-fg/90">
        {label}
      </label>
      {children ?? (
        <input
          id={fieldId}
          name={name}
          className="field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...inputProps}
        />
      )}
      {error ? (
        <p id={`${fieldId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  className,
  children,
  invalid,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn("field-input appearance-none pr-8", className)} aria-invalid={invalid || undefined} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("field-input h-auto min-h-[88px] py-2", className)} {...props} />;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}
