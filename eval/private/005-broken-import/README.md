# Task: Fix the broken build

`index.ts` imports `./util.ts`, which is missing. Create `util.ts` exporting `ok()` that returns `"ok"`.
`bun test index.test.ts` must exit 0.
