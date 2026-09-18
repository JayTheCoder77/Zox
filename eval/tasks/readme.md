Eval tasks are YAML fixtures scored with `expect.stdoutIncludes` and/or `expect.files` substring checks.

- Mock (CI / default): `zox eval run` loads `eval/tasks/mock` with `mock/echo`.
- Live (local, BYOK): `zox eval run eval/tasks/live --model <provider/id>` requires a real model. Do not clone SWE-bench; `edit-add` is the in-repo coding fixture.

Optional flags: `--max-turns` (live default 50), `--timeout-ms` (default 300000), `--sandbox`.
