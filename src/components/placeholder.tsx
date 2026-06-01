import type { ReactNode } from "react";

interface PlaceholderProps {
  title: string;
  description: string;
  phase: string;
  children?: ReactNode;
}

export function Placeholder({ title, description, phase, children }: PlaceholderProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-6">
        <h1 className="text-base font-semibold">{title}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <p className="text-muted-foreground text-sm">{description}</p>
          <p className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
            {phase}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
