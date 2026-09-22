import { cn } from "@/lib/cn";

export type AsciiMark = "+" | "-" | "x" | "*";

export type AsciiListRow = {
  mark: AsciiMark;
  title: string;
  body?: string;
};

type AsciiListProps = {
  rows: AsciiListRow[];
  className?: string;
};

export function AsciiList({ rows, className }: AsciiListProps) {
  return (
    <ul className={cn("m-0 list-none space-y-3 p-0", className)}>
      {rows.map((row) => (
        <li key={row.title} className="flex gap-3 text-base leading-normal">
          <span className="shrink-0 font-medium text-ink" aria-hidden>
            [{row.mark}]
          </span>
          <span>
            <span className="font-medium text-ink">{row.title}</span>
            {row.body ? (
              <span className="text-body">
                {" — "}
                {row.body}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
