import { DocsSidebar } from "@/components/docs/sidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 lg:py-12">
      <div className="mb-6 lg:hidden">
        <details className="rounded-[4px] border border-hairline bg-surface-soft">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">
            Menu
          </summary>
          <div className="border-t border-hairline px-4 py-4">
            <DocsSidebar />
          </div>
        </details>
      </div>
      <div className="flex gap-10">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <DocsSidebar />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
