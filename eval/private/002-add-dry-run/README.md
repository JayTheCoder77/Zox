# Task: Add --dry-run flag to the CLI

The `process` command currently always writes `out.txt`.
Add a `--dry-run` flag that prints what would be written without touching disk.

Constraints:
- Do not break existing flags
- Update help text
- Existing tests must still pass
