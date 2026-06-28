import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function Collapsible({
  title,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="panel p-5 [&[open]>summary_svg]:rotate-90">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-ink-soft transition-transform" size={14} />
        <span className="kicker">{title}</span>
      </summary>
      {children}
    </details>
  );
}
