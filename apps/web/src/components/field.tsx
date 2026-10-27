import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type FieldProps = { id: string; label: string; hint?: string } & (
  | ({ multiline?: false } & ComponentProps<typeof Input>)
  | ({ multiline: true } & ComponentProps<typeof Textarea>)
);

// A labelled input; the hint is tied to it with aria-describedby.
export function Field({ id, label, hint, multiline, ...props }: FieldProps) {
  const describedBy = hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} aria-describedby={describedBy} {...(props as ComponentProps<typeof Textarea>)} />
      ) : (
        <Input id={id} aria-describedby={describedBy} {...(props as ComponentProps<typeof Input>)} />
      )}
      {hint && (
        <p id={describedBy} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
