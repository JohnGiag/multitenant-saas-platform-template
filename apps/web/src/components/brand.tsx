import { Layers } from 'lucide-react';
import { cn } from 'cn';

export function Brand({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-3 font-semibold tracking-tight', className)}>
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Layers className="size-4" />
      </span>
      Admin
    </p>
  );
}
