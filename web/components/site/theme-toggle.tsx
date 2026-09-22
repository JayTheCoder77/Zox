"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className="text-sm font-medium text-ink opacity-0"
        aria-hidden
        tabIndex={-1}
      >
        light
      </button>
    );
  }

  const label =
    theme === "system" ? `system (${resolvedTheme ?? "light"})` : (theme ?? "light");

  function cycle() {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="text-sm font-medium text-ink hover:opacity-70"
      aria-label={`Theme: ${label}. Click to change.`}
    >
      {theme === "system" ? "system" : theme === "dark" ? "dark" : "light"}
    </button>
  );
}
