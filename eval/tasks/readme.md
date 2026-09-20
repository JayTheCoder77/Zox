Eval tasks are YAML fixtures scored with `expect.stdoutIncludes` and/or `expect.files` substring checks.

- Mock (CI / default): `zox eval run` loads `eval/tasks/mock` with `mock/echo`.
- Live (local, BYOK): `zox eval run eval/tasks/live --model <provider/id>` requires a real model.

Optional flags: `--max-turns` (live default 50), `--timeout-ms` (default 300000), `--sandbox`.

## Private suite (daily iteration)

Versioned tasks live in `eval/private/<id>/` (`README.md` prompt, `repo/` starting tree, hidden `tests/` + `grader.sh`, `meta.json`). The agent never sees `tests/` or `grader.sh`. Default `k=3` trials.

```sh
zox eval private --model <provider/id>
zox eval private --model <provider/id> --k 1
./scripts/run_private_evals.sh
```

Scores: `pass@1`, `pass@k`, median latency, $/task, tools/task. Artifacts: `eval/results/private/<task>/trial-N/{transcript.txt,patch.diff,summary.json}`.

## Official harness subsets (local, not CI)

These commands do **not** use YAML `expect.files`. They score with upstream graders. Clones, images, and logs land in gitignored `eval/benchmarks/cache/` and `eval/results/`.

### SWE-bench Lite

Requires Docker and `pip install swebench` **in the repo `.venv` or active `VIRTUAL_ENV`**. Needs a real `--model` (not `mock/*`).

Default smoke IDs (`eval/benchmarks/swe-lite-smoke.json`) are the first three of the fixed 10-id list in `eval/benchmarks/swe-lite-subset.json`. Re-run the same IDs after harness changes.

```sh
zox eval swe-lite --model <provider/id>
zox eval swe-lite --model <provider/id> --instance-id django__django-11099 --limit 1
zox eval swe-lite --model <provider/id> --skip-eval
```

`--skip-eval` writes `eval/results/swe-lite/<runId>/predictions.jsonl` and stops before Docker.

### Terminal-Bench 2.0

Requires Docker and `pip install harbor` (or `uv tool install harbor`). Needs a real `--model`.

```sh
zox eval terminal-bench --model <provider/id>
zox eval terminal-bench --model <provider/id> --task openssl-selfsigned-cert --limit 1
zox eval terminal-bench --model <provider/id> --n-attempts 3
```

Harbor runs `eval/adapters/harbor/zox_agent.py` (`ZoxInstalledAgent`) inside the trial container. Default smoke task names are in `eval/benchmarks/terminal-bench-smoke.json`. Jobs go to `eval/results/terminal-bench` (override with `--jobs-dir`).

## Archive

```sh
zox eval archive
```
