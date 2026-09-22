"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsNav } from "@/lib/docs-nav";
import { cn } from "@/lib/cn";

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Docs" className="space-y-6 text-sm">
      {docsNav.map((group) => (
        <div key={group.label}>
          <p className="mb-2 text-sm text-mute">{group.label}</p>
          <ul className="m-0 list-none space-y-1 p-0">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block border-l-2 py-1 pl-3 text-body transition-colors",
                      active
                        ? "border-ink font-medium text-ink"
                        : "border-transparent hover:text-ink",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
