import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost" | "link";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-on-primary hover:opacity-90 active:bg-ink-deep border border-transparent",
  ghost: "bg-transparent text-ink border border-hairline hover:bg-surface-soft",
  link: "bg-transparent text-ink border border-transparent underline-offset-4 hover:underline px-0",
};

type CommonProps = {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center rounded-[4px] px-4 py-2 text-base font-medium transition-opacity duration-150",
    variantClasses[variant],
    className,
  );

  if ("href" in rest && typeof rest.href === "string") {
    const { href } = rest;
    if (href.startsWith("http")) {
      return (
        <a
          href={href}
          className={classes}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  const buttonRest = rest as Omit<ButtonAsButton, keyof CommonProps>;
  return (
    <button type="button" className={classes} {...buttonRest}>
      {children}
    </button>
  );
}
