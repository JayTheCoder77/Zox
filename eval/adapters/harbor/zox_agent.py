from __future__ import annotations

import os
import shlex
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

ZOX_IN_ENV = "/opt/zox"
BUN_VERSION = "1.4.0"
PROVIDER_KEYS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "TOGETHER_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "XAI_API_KEY",
)
SKIP_ARCHIVE_DIRS = {
    ".git",
    ".zox",
    "jobs",
    "logs",
    "node_modules",
    "eval/benchmarks/cache",
    "eval/results",
}


class ZoxInstalledAgent(BaseInstalledAgent):
    @staticmethod
    def name() -> str:
        return "zox"

    async def install(self, environment: BaseEnvironment) -> None:
        zox_root = os.environ.get("ZOX_ROOT")
        if not zox_root:
            raise RuntimeError("ZOX_ROOT must point at the Zox checkout")

        upload_file = getattr(environment, "upload_file", None)
        if not callable(upload_file):
            raise RuntimeError("Harbor environment cannot upload_file into the trial")

        uname = await self.exec_as_root(environment, command="uname -m")
        arch = (getattr(uname, "stdout", None) or "x86_64").strip()
        bun_bin = _ensure_linux_bun(zox_root, arch)
        result = upload_file(str(bun_bin), "/tmp/bun")
        if hasattr(result, "__await__"):
            await result
        await self.exec_as_root(
            environment,
            command="install -m 0755 /tmp/bun /usr/local/bin/bun",
        )

        await self.exec_as_root(environment, command=f"mkdir -p {ZOX_IN_ENV}")
        archive = _archive_zox(zox_root)
        try:
            packed = upload_file(archive, "/tmp/zox.tgz")
            if hasattr(packed, "__await__"):
                await packed
            await self.exec_as_root(
                environment,
                command=f"tar -xzf /tmp/zox.tgz -C {ZOX_IN_ENV}",
            )
        finally:
            Path(archive).unlink(missing_ok=True)

        await self.exec_as_root(
            environment,
            command=(
                f"export PATH=/usr/local/bin:$PATH; "
                f"cd {ZOX_IN_ENV} && bun install"
            ),
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        model = getattr(self, "model_name", None) or os.environ.get("ZOX_MODEL")
        if not model:
            raise RuntimeError("ZoxInstalledAgent requires a model")
        zox = os.environ.get("ZOX_IN_ENV", ZOX_IN_ENV)
        extra = {key: os.environ[key] for key in PROVIDER_KEYS if os.environ.get(key)}
        extra["ZOX_ROOT"] = zox
        command = (
            "export PATH=/usr/local/bin:$PATH; "
            f"bun {shlex.quote(str(Path(zox) / 'packages/cli/src/index.ts'))} "
            "agent run . "
            f"{shlex.quote(instruction)} "
            "--no-tui --auto-approve --sandbox host "
            f"--model {shlex.quote(str(model))}"
        )
        await self.exec_as_agent(environment, command=command, env=extra)


def linux_bun_slug(arch: str) -> str:
    if arch in ("aarch64", "arm64"):
        return "bun-linux-aarch64"
    return "bun-linux-x64"


def linux_bun_urls(slug: str) -> list[str]:
    return [
        f"https://github.com/oven-sh/bun/releases/download/bun-v{BUN_VERSION}/{slug}.zip",
        f"https://registry.npmjs.org/@oven/{slug}/-/{slug}-{BUN_VERSION}.tgz",
    ]


def _ensure_linux_bun(zox_root: str, arch: str) -> Path:
    slug = linux_bun_slug(arch)
    cache_dir = Path(zox_root) / "eval/benchmarks/cache/bun"
    dest = cache_dir / slug / "bun"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return dest
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    for url in linux_bun_urls(slug):
        archive_path = cache_dir / (
            f"{slug}.tgz" if url.endswith(".tgz") else f"{slug}.zip"
        )
        try:
            _download_with_retries(url, archive_path)
            _extract_bun(archive_path, dest)
            dest.chmod(0o755)
            if dest.exists() and dest.stat().st_size > 1_000_000:
                return dest
            errors.append(f"{url}: extracted bun too small")
        except Exception as exc:  # noqa: BLE001 — next mirror
            errors.append(f"{url}: {exc}")
    raise RuntimeError("failed to download linux bun: " + "; ".join(errors))


def _download_with_retries(url: str, dest: Path, attempts: int = 4) -> None:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            urllib.request.urlretrieve(url, dest)
            if dest.exists() and dest.stat().st_size > 0:
                return
            raise RuntimeError(f"empty download from {url}")
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"download failed {url}: {last}")


def _extract_bun(archive_path: Path, dest: Path) -> None:
    if archive_path.suffix == ".tgz" or archive_path.name.endswith(".tgz"):
        with tarfile.open(archive_path, "r:gz") as archive:
            member = next(
                (
                    info
                    for info in archive.getmembers()
                    if info.isfile() and info.name.endswith("bun")
                ),
                None,
            )
            if not member:
                raise RuntimeError(f"bun binary missing from {archive_path}")
            extracted = archive.extractfile(member)
            if extracted is None:
                raise RuntimeError(f"bun binary missing from {archive_path}")
            dest.write_bytes(extracted.read())
        return
    with zipfile.ZipFile(archive_path) as archive:
        member = next(
            (
                name
                for name in archive.namelist()
                if name.endswith("bun") and not name.endswith("/")
            ),
            None,
        )
        if not member:
            raise RuntimeError(f"bun binary missing from {archive_path}")
        with archive.open(member) as src, dest.open("wb") as out:
            out.write(src.read())


def _archive_zox(zox_root: str) -> str:
    root = Path(zox_root)
    handle = tempfile.NamedTemporaryFile(suffix=".tgz", delete=False)
    handle.close()

    def skip(path: Path) -> bool:
        rel = path.relative_to(root).as_posix()
        return any(
            rel == ignored or rel.startswith(f"{ignored}/")
            for ignored in SKIP_ARCHIVE_DIRS
        )

    with tarfile.open(handle.name, "w:gz") as tar:
        for dirpath, dirnames, filenames in os.walk(root):
            current = Path(dirpath)
            dirnames[:] = [name for name in dirnames if not skip(current / name)]
            if skip(current) and current != root:
                continue
            for name in filenames:
                path = current / name
                if skip(path):
                    continue
                tar.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
    return handle.name
