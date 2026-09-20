#!/usr/bin/env python3
"""Load SWE-bench Lite rows by instance_id. Does not vendor the dataset."""

from __future__ import annotations

import json
import sys


def main(ids: list[str]) -> None:
    if not ids:
        print("usage: load_instances.py <instance_id> [...]", file=sys.stderr)
        raise SystemExit(1)
    try:
        from datasets import load_dataset
    except ImportError as exc:
        print(
            "install datasets or swebench to load princeton-nlp/SWE-bench_Lite",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    wanted = set(ids)
    dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    found: list[dict[str, str]] = []
    for row in dataset:
        instance_id = row["instance_id"]
        if instance_id not in wanted:
            continue
        found.append(
            {
                "instance_id": instance_id,
                "repo": row["repo"],
                "base_commit": row["base_commit"],
                "problem_statement": row["problem_statement"],
            }
        )
        if len(found) == len(wanted):
            break

    missing = wanted - {item["instance_id"] for item in found}
    if missing:
        print(f"missing instance ids: {sorted(missing)}", file=sys.stderr)
        raise SystemExit(1)

    json.dump(found, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
