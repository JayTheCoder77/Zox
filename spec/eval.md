# Coding Agent Harness — Evaluation Guide

Practical eval setup for an OpenCode-style agentic coding harness.  
**Full public benchmarks are expensive** (hundreds of tasks, Docker, tokens).  
This doc uses **small subsets only** + a lightweight private suite for day-to-day iteration.

---

## 1. Principles

| Principle | Why |
|-----------|-----|
| Fresh sandbox per task | No leftover files/caches skew results |
| Grade outcomes, not paths | Prefer test-pass / final state over exact tool sequence |
| Multiple trials | Agents are non-deterministic → use `pass@k` |
| Persist artifacts | Keep patch + transcript so you can re-grade without re-running the agent |
| Always record harness + model + config | Scores are harness-dependent |

**Metrics to track**

- Resolve rate (`pass@1` and `pass@k`)
- Cost per successful task (tokens / $)
- Wall-clock latency
- Tool-call count / failure rate
- (Optional) LLM-judge scores on code quality

---

## 2. SWE-bench (subset)

SWE-bench gives the agent a real GitHub issue + repo at the pre-fix commit.  
Success = apply the agent’s patch and the repo’s tests pass (fail-to-pass + no regressions).

### Recommended subsets

| Subset | Size | When to use |
|--------|------|-------------|
| **SWE-bench Lite** | 300 | Still large — pick 10–30 instances |
| **SWE-bench Verified** | 500 | Same — sample 10–20 for smoke tests |
| **Hand-picked** | 5–15 | Best for daily iteration |

Start with a **fixed list of 10–15 instance IDs** so results are comparable across harness changes.

### Setup

```bash
# Install
pip install swebench
# or
git clone https://github.com/SWE-bench/SWE-bench && cd SWE-bench && pip install -e .
```

### Generate predictions with your harness

Your agent must emit a **unified diff patch** per instance.

Output format (`predictions.jsonl`):

```json
{"instance_id": "django__django-11099", "model_name_or_path": "my-harness/model-x", "model_patch": "diff --git a/...\n..."}
{"instance_id": "sympy__sympy-20590", "model_name_or_path": "my-harness/model-x", "model_patch": "diff --git a/...\n..."}
```

Wrapper sketch:

```bash
# For each instance_id in your subset list:
# 1. Provision sandbox / clone repo at base commit (or let SWE-bench images handle it)
# 2. Feed issue text + tools to your agent
# 3. Capture final patch → append line to predictions.jsonl
```

### Evaluate (subset only)

```bash
# Pull/build images only for the instances you care about (saves time/disk)
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path predictions.jsonl \
  --max_workers 4 \
  --run_id my-harness-smoke \
  --instance_ids django__django-11099 sympy__sympy-20590 astropy__astropy-12907
  # add more IDs as needed
```

Useful instance IDs to start with (Lite / commonly used):

```
django__django-11099
sympy__sympy-20590
astropy__astropy-12907
matplotlib__matplotlib-23299
scikit-learn__scikit-learn-13439
pytest-dev__pytest-7490
pylint-dev__pylint-4551
requests__requests-2317
sphinx-doc__sphinx-8595
flask__flask-4045
```

(Verify current IDs in the dataset; some may be filtered in newer splits.)

### Interpreting results

- Official metric = **% resolved** (binary per task).
- Report: `resolved / total`, cost, median latency, harness version, model.
- Re-run the same 10–15 IDs after every meaningful harness change.

---

## 3. Terminal-Bench (subset)

Terminal-Bench tests end-to-end terminal workflows (build, configure, debug, data tasks) inside containers.  
Grading is based on **final environment state + tests**, not the path taken.

### Recommended approach

Do **not** run the full 89-task set at first.

1. Pick **5–10 tasks** that match your harness strengths (software-engineering / debugging / file ops).
2. Use the official Harbor / Terminal-Bench runner with a task filter if available.
3. Or manually drive your agent inside the published Docker images for those tasks and run the provided test scripts.

### High-level flow

```text
for each selected task:
  1. Start the task’s Docker environment
  2. Give your agent shell access + the task instruction
  3. Let it run until done or budget exhausted
  4. Execute the task’s official test harness → pass / fail
  5. Record transcript, tokens, wall time
```

### Practical subset ideas

Choose tasks that exercise:

- Multi-file code changes + running tests
- Dependency / environment debugging
- Shell scripting + file manipulation
- Simple build-from-source or config fixes

(Exact task names live in the Terminal-Bench registry / Harbor docs — pick ones with clear, deterministic tests.)

### Minimal wrapper

```bash
# Pseudocode
harbor run -d terminal-bench@2.0 \
  -a my-agent \
  -m "my-model" \
  --tasks task_id_1,task_id_2,task_id_3 \
  --n-attempts 3 \
  --jobs-dir ./tb-results
```

If Harbor isn’t wired yet: spin the task container yourself, exec your agent CLI inside it, then run the task’s `test.sh` (or equivalent).

---

## 4. Small Own Task Suite (recommended for daily use)

Public benchmarks are noisy and slow. A **private suite of 8–15 tasks** is the highest-leverage eval for harness development.

### Design rules

1. **Clear success criteria** — Prefer “tests pass” or “file X contains Y” over subjective judgment.
2. **Realistic but bounded** — 5–30 minutes of agent work, not multi-hour epics.
3. **Isolated** — Each task starts from a known git commit or tarball.
4. **Hidden tests** — Agent never sees the final grader tests (or sees only a subset).
5. **Versioned** — Store tasks in git; never silently change a task after results exist.

### Suggested task categories (aim for 2–3 of each)

| Category | Example | Grader |
|----------|---------|--------|
| Bug fix | Failing unit test + stack trace | Test suite must pass |
| Small feature | “Add `--dry-run` flag” | New tests + existing tests pass |
| Refactor | “Extract helper, keep behavior” | Tests + optional diff size limit |
| Multi-file | “Wire new endpoint + update client” | Integration test |
| Debugging | Broken build / missing dep | `make test` or `npm test` exits 0 |
| CLI / script | “Write a script that transforms CSV” | Golden output comparison |
| Recovery | Intentionally broken intermediate state | Agent must still finish |

### Task layout (recommended)

```text
tasks/
  001-add-dry-run/
    README.md          # instruction given to the agent
    repo/              # or git submodule / sparse checkout
    base.commit        # starting point
    tests/             # hidden from agent (or partially hidden)
    grader.sh          # exit 0 = pass
    meta.json          # expected time budget, tags, difficulty
  002-fix-npe/
    ...
```

`README.md` example:

```markdown
# Task: Add --dry-run flag to the CLI

The `process` command currently always writes files.
Add a `--dry-run` flag that prints what would be written without touching disk.

Constraints:
- Do not break existing flags
- Update help text
- Existing tests must still pass
```

`grader.sh` example:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd repo
pytest tests/ -q          # or npm test / go test ./...
# optional extra checks
grep -q "dry-run" src/cli.py || exit 1
```

### Running the private suite

```bash
#!/usr/bin/env bash
# run_private_evals.sh
HARNESS="my-agent"
MODEL="claude-sonnet-..."
K=3   # trials per task

for task in tasks/*/; do
  for i in $(seq 1 $K); do
    rm -rf /tmp/work && mkdir /tmp/work
    # restore base state
    cp -a "$task/repo/." /tmp/work/   # or git checkout $(cat base.commit)
    # run agent
    $HARNESS --model "$MODEL" --workdir /tmp/work --prompt "$(cat $task/README.md)" \
      > /tmp/transcript.txt 2>&1 || true
    # grade
    if (cd /tmp/work && bash "$task/grader.sh"); then
      echo "PASS $task trial $i"
    else
      echo "FAIL $task trial $i"
    fi
    # archive artifacts
    mkdir -p results/$(basename $task)/trial-$i
    cp /tmp/transcript.txt results/.../
    # optionally save git diff
  done
done
```

### Scoring the private suite

For each task:

- `pass@1` = fraction of first trials that succeed  
- `pass@k` = fraction of tasks with ≥1 success in k trials  
- Average cost & latency across successful and failed runs

Keep a simple results table (markdown or CSV) with date, harness commit, model, and scores.

---

## 5. Recommended Daily / Weekly Cadence

| Frequency | What to run | Size |
|-----------|-------------|------|
| **Every harness change** | Private suite (all tasks, k=1 or 2) | 8–15 tasks |
| **2–3× per week** | SWE-bench hand-picked subset | 10–15 instances |
| **Weekly / release** | Larger SWE-bench sample + Terminal-Bench sample | 20–30 + 5–10 |
| **Monthly** | Broader public subsets for external comparison | as budget allows |

---

## 6. Checklist Before Trusting a Number

- [ ] Same harness commit + model + temperature / tool config
- [ ] Fresh environment per trial
- [ ] Predictions / transcripts saved
- [ ] Grader is deterministic (or LLM judge has a fixed rubric + seed)
- [ ] Instance / task list is fixed and documented
- [ ] Cost and latency recorded alongside resolve rate

---

## 7. Quick Reference Commands

```bash
# SWE-bench subset eval
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path predictions.jsonl \
  --instance_ids id1 id2 id3 \
  --max_workers 4 \
  --run_id smoke-$(date +%Y%m%d)

# Private suite
./run_private_evals.sh

# Archive everything
tar czf eval-$(date +%Y%m%d-%H%M).tar.gz predictions.jsonl results/ tasks/
```

---

## References

- SWE-bench: https://github.com/SWE-bench/SWE-bench  
- Terminal-Bench / Harbor: https://tbench.ai (or current Harbor docs)  
- Anthropic — Demystifying evals for AI agents  
- Keep this file next to your harness repo and update the instance/task lists as you grow the suite.
