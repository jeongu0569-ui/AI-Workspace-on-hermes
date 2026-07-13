#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import queue
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

from prompt_toolkit import PromptSession, print_formatted_text
from prompt_toolkit.formatted_text import ANSI
from prompt_toolkit.patch_stdout import patch_stdout
from prompt_toolkit.styles import Style


PURPLE = "\033[38;5;141m"
BORDER = "\033[38;5;245m"
GREEN = "\033[32m"
DIM = "\033[2m"
RED = "\033[31m"
RESET = "\033[0m"


@dataclass
class RuntimeState:
    model: str = ""
    provider: str = ""
    workspace_root: str = ""
    session_id: str = ""
    prompt_tokens: int | None = None
    context_window: int | None = None
    reasoning_started: bool = False


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--root", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--cli", required=True)
    args = parser.parse_args()

    proc = subprocess.Popen(
        [args.node, args.cli, "chat-stdio", "--root", args.root],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    events: "queue.Queue[dict[str, Any]]" = queue.Queue()
    stderr_lines: "queue.Queue[str]" = queue.Queue()
    state = RuntimeState()

    threading.Thread(target=_read_stdout, args=(proc, events), daemon=True).start()
    threading.Thread(target=_read_stderr, args=(proc, stderr_lines), daemon=True).start()

    ready = _wait_ready(events, stderr_lines, timeout=15)
    if not ready:
        print(f"{RED}Codmes TUI failed to start runtime bridge.{RESET}")
        return 1
    if ready.get("kind") == "error":
        print(f"{RED}{ready.get('error')}{RESET}")
        return 1

    state.model = str(ready.get("model") or "")
    state.provider = str(ready.get("provider") or "")
    state.workspace_root = str(ready.get("workspaceRoot") or "")
    state.session_id = str(ready.get("sessionId") or "")

    _render_welcome(state)
    session = PromptSession(
        message=ANSI(f"{PURPLE}❯ {RESET}"),
        style=Style.from_dict({
            "": "",
        }),
    )

    with patch_stdout(raw=True):
        while True:
            try:
                text = session.prompt()
            except (KeyboardInterrupt, EOFError):
                break
            message = text.strip()
            if not message:
                continue
            if message.lower() in {"exit", "quit", "/exit"}:
                break
            if message == "/help":
                _print_help()
                continue

            request_id = uuid.uuid4().hex
            _send(proc, {
                "id": request_id,
                "command": "prompt.submit",
                "message": message,
            })
            _print_rule()
            print_formatted_text(ANSI(f"{GREEN}✦ Agent{RESET}"))
            _drain_until_result(events, request_id, state)
            print("")
            _print_status(state)

    _send(proc, {"command": "exit"})
    try:
        proc.terminate()
    except Exception:
        pass
    print_formatted_text(ANSI(f"\n{DIM}Chat session closed.{RESET}"))
    return 0


def _read_stdout(proc: subprocess.Popen[str], events: "queue.Queue[dict[str, Any]]") -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            events.put(json.loads(line))
        except json.JSONDecodeError:
            events.put({"kind": "log", "text": line})


def _read_stderr(proc: subprocess.Popen[str], lines: "queue.Queue[str]") -> None:
    assert proc.stderr is not None
    for line in proc.stderr:
        if line.strip():
            lines.put(line.rstrip("\n"))


def _wait_ready(events: "queue.Queue[dict[str, Any]]", stderr_lines: "queue.Queue[str]", timeout: float) -> dict[str, Any] | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            item = events.get(timeout=0.1)
        except queue.Empty:
            continue
        if item.get("kind") in {"ready", "error"}:
            return item
        if item.get("kind") == "log":
            print(item.get("text", ""))
    while not stderr_lines.empty():
        print(stderr_lines.get())
    return None


def _send(proc: subprocess.Popen[str], payload: dict[str, Any]) -> None:
    if proc.stdin is None:
        return
    proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    proc.stdin.flush()


def _drain_until_result(events: "queue.Queue[dict[str, Any]]", request_id: str, state: RuntimeState) -> None:
    while True:
        item = events.get()
        kind = item.get("kind")
        if kind == "event":
            _handle_runtime_event(item.get("event") or {}, state)
            continue
        if kind == "result" and item.get("id") == request_id:
            if not item.get("ok"):
                print_formatted_text(ANSI(f"\n{RED}Error:{RESET} {item.get('error', 'Unknown error')}"))
            if state.reasoning_started:
                print("")
                state.reasoning_started = False
            return
        if kind == "error":
            print_formatted_text(ANSI(f"\n{RED}Error:{RESET} {item.get('error', 'Unknown error')}"))
            return
        if kind == "log":
            print(item.get("text", ""))


def _handle_runtime_event(event: dict[str, Any], state: RuntimeState) -> None:
    event_type = str(event.get("type") or "")
    text = str(event.get("text") or "")
    if event_type == "turn.start":
        state.prompt_tokens = _as_int(event.get("promptTokenEstimate"))
        state.context_window = _as_int(event.get("contextWindow"))
        state.reasoning_started = False
        return
    if event_type in {"reasoning.delta", "thinking.delta", "assistant.reasoning.delta", "assistant.thinking.delta"} and text:
        if not state.reasoning_started:
            state.reasoning_started = True
            print_formatted_text(ANSI(f"{DIM}thinking...{RESET}"))
        print(f"{DIM}{text}{RESET}", end="", flush=True)
        return
    if event_type in {"message.delta", "assistant.delta", "assistant.message.delta"} and text:
        if state.reasoning_started:
            print("")
            state.reasoning_started = False
        print(text, end="", flush=True)
        return
    if event_type.startswith("tool.") or event_type in {"approval.required", "tool.expansion.applied"}:
        label = event.get("toolName") or event.get("summary") or event_type
        print_formatted_text(ANSI(f"\n{DIM}{event_type}: {label}{RESET}"))


def _render_welcome(state: RuntimeState) -> None:
    print("\033[2J\033[H", end="")
    logo = [
        " ██████╗ ██████╗ ██████╗ ███╗   ███╗███████╗███████╗",
        "██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔════╝██╔════╝",
        "██║     ██║   ██║██║  ██║██╔████╔██║█████╗  ███████╗",
        "██║     ██║   ██║██║  ██║██║╚██╔╝██║██╔══╝  ╚════██║",
        "╚██████╗╚██████╔╝██████╔╝██║ ╚═╝ ██║███████╗███████║",
        " ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚══════╝",
    ]
    for line in logo:
        print_formatted_text(ANSI(f"{PURPLE}{line}{RESET}"))
    print("")
    _print_box("Codmes", [
        ("Runtime", "Codmes Runtime"),
        ("Model", f"{state.model} · {state.provider}"),
        ("Workspace", state.workspace_root),
        ("Session", state.session_id),
        ("Commands", "/help · /exit · quit"),
    ])
    print_formatted_text(ANSI(f"{DIM}Welcome to Codmes. Type your message, or /help for commands.{RESET}"))
    _print_status(state)


def _print_help() -> None:
    _print_box("Commands", [
        ("/help", "Show this help"),
        ("/exit", "Close the chat session"),
        ("quit", "Close the chat session"),
    ])


def _print_box(title: str, rows: list[tuple[str, str]]) -> None:
    width = 118
    print_formatted_text(ANSI(f"{BORDER}╭ {title} {'─' * (width - len(title) - 3)}╮{RESET}"))
    for label, value in rows:
        raw = f" {label:<10} {_fit(value, width - 13)}"
        print_formatted_text(ANSI(f"{BORDER}│{RESET}{raw:<{width}}{BORDER}│{RESET}"))
    print_formatted_text(ANSI(f"{BORDER}╰{'─' * width}╯{RESET}"))
    print("")


def _print_status(state: RuntimeState) -> None:
    _print_rule()
    ctx = "--"
    percent = 0
    bar = "░" * 10
    if state.context_window:
        prompt = state.prompt_tokens or 0
        percent = min(100, round((prompt / state.context_window) * 100))
        filled = min(10, max(0, round(percent / 10)))
        bar = "█" * filled + "░" * (10 - filled)
        ctx = f"{_compact(prompt)} / {_compact(state.context_window)}"
    print_formatted_text(ANSI(f"{PURPLE}⚕{RESET}{DIM} {state.model} │ ctx {ctx} │ [{bar}] {percent}% │ ready{RESET}"))
    _print_rule()


def _print_rule() -> None:
    print_formatted_text(ANSI(f"{BORDER}{'─' * 120}{RESET}"))


def _fit(value: str, width: int) -> str:
    text = str(value)
    if len(text) <= width:
        return text
    return text[: max(1, width - 1)] + "…"


def _compact(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M".replace(".0M", "M")
    if value >= 1_000:
        return f"{value / 1_000:.1f}K".replace(".0K", "K")
    return str(value)


def _as_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
