"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Bot,
  Telescope,
  Workflow,
  Brain,
  Settings,
  SquareTerminal,
  Library,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const primaryItems: NavItem[] = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/research", label: "Deep Research", icon: Telescope },
  { href: "/canvas", label: "Canvas", icon: Workflow },
  { href: "/opencode", label: "OpenCode", icon: SquareTerminal },
  { href: "/editor", label: "Editor", icon: NotebookPen },
  { href: "/documents", label: "Documents", icon: Library },
  { href: "/memory", label: "Memory", icon: Brain },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  index,
}: {
  item: NavItem;
  active: boolean;
  index: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      style={{ animationDelay: `${index * 45}ms` }}
      className={cn(
        "animate-fade-in-up group relative flex items-center gap-3 px-3 py-2 text-[0.82rem] font-medium tracking-wide uppercase",
        "before:absolute before:top-1/2 before:left-0 before:h-0 before:w-[2px] before:-translate-y-1/2 before:bg-primary before:transition-all before:content-['']",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground text-glow-cyan before:h-[70%] before:shadow-[0_0_10px_var(--neon-magenta)]"
          : "text-muted-foreground hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:bg-sidebar-accent/50 hover:before:h-[40%]",
      )}
    >
      <Icon
        className={cn(
          "size-4 transition-transform group-hover:scale-110",
          active && "drop-shadow-[0_0_6px_var(--neon-cyan)]",
        )}
      />
      {item.label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="bg-sidebar text-sidebar-foreground relative flex h-full w-56 shrink-0 flex-col border-r shadow-[1px_0_14px_-4px_var(--neon-magenta)]">
      <div className="font-pixel flex h-14 items-center gap-2 px-4 text-sm">
        <span className="text-primary animate-flicker tracking-tight">LOOM</span>
        <span className="bg-neon-cyan animate-blink inline-block h-3.5 w-2 shadow-[0_0_8px_var(--neon-cyan)]" />
      </div>
      <div className="border-sidebar-border/60 mx-3 mb-2 border-b" />
      <div className="flex flex-1 flex-col gap-1 px-2 py-1">
        {primaryItems.map((item, index) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            index={index}
          />
        ))}
      </div>
      <div className="border-sidebar-border/60 border-t px-2 py-2">
        <NavLink
          item={{ href: "/settings", label: "Settings", icon: Settings }}
          active={isActive(pathname, "/settings")}
          index={primaryItems.length}
        />
      </div>
    </nav>
  );
}
