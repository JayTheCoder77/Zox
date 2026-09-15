export type PlanItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "done";
  notes?: string;
};

const STATUSES = new Set<PlanItem["status"]>([
  "pending",
  "in_progress",
  "done",
]);

export function parsePlan(input: unknown): PlanItem[] {
  if (!Array.isArray(input)) {
    throw new Error("Plan must be an array");
  }
  return input.map((entry, index) => parseItem(entry, index));
}

function parseItem(entry: unknown, index: number): PlanItem {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`Plan item ${index} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  const content = record.content;
  const status = record.status;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Plan item ${index} missing id`);
  }
  if (typeof content !== "string") {
    throw new Error(`Plan item ${index} missing content`);
  }
  if (
    typeof status !== "string" ||
    !STATUSES.has(status as PlanItem["status"])
  ) {
    throw new Error(`Plan item ${index} has invalid status`);
  }
  const item: PlanItem = {
    id,
    content,
    status: status as PlanItem["status"],
  };
  if (record.notes !== undefined) {
    if (typeof record.notes !== "string") {
      throw new Error(`Plan item ${index} notes must be a string`);
    }
    item.notes = record.notes;
  }
  return item;
}
