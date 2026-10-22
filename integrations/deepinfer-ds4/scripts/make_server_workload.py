#!/usr/bin/env python3
# Part of DS4-Studio DeepInfer integration (Gate 0 server leg: tool-use and sampling).
"""Write the server workload JSON used by server_matrix.py.

Prompts are built only from DS4 source files in this repository (no user data).
Scenarios:
- tool-*  : agent-shaped Chat Completions with tool schemas, a prior tool call and
            its result; greedy, thinking on. Measures decode and TTFT.
- sample  : short high-entropy completions at temperature 1, many seeds. Compares
            output distributions between configurations.
- sampled-code : one longer temperature 0.7 generation. Measures decode speed
            under sampling.
"""
import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]

TOOLS = [
    {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props, "required": list(props)}}}
    for name, desc, props in [
        ("read_file", "Read a file from the workspace", {"path": {"type": "string"}}),
        ("grep", "Search the workspace with a regular expression",
         {"pattern": {"type": "string"}, "path": {"type": "string"}}),
        ("list_dir", "List a directory", {"path": {"type": "string"}}),
        ("apply_patch", "Apply a unified diff to the workspace", {"patch": {"type": "string"}}),
        ("run_tests", "Run a test target and return its output", {"target": {"type": "string"}}),
    ]
]
SYSTEM = ("You are a coding agent working in a C repository. Use the tools to inspect "
          "files before answering. Keep answers short and precise.")


def call(cid, name, args):
    return {"role": "assistant", "content": "", "tool_calls": [{"id": cid, "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}}]}


def result(cid, text):
    return {"role": "tool", "tool_call_id": cid, "content": text}


def src(name, limit):
    return (ROOT / name).read_text(encoding="utf-8", errors="replace")[:limit]


def build():
    kv = src("ds4_kvstore.c", 24000)
    rax = src("rax.h", 14000)
    buf = src("buf.c", 4000)
    tool = {"thinking": {"type": "enabled"}, "reasoning_effort": "high", "temperature": 0,
            "max_tokens": 768, "tools": TOOLS}
    scenarios = [
        {"name": "tool-next-step", "nonce": True, "request": {**tool, "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Where does the KV store decide that a checkpoint is too old to keep? "
                                        "Find the function and the condition."},
            call("c1", "read_file", {"path": "ds4_kvstore.c"}), result("c1", kv)]}},
        {"name": "tool-final-answer", "nonce": True, "request": {**tool, "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Summarize the public API of rax.h in a short list."},
            call("c1", "read_file", {"path": "rax.h"}), result("c1", rax)]}},
        {"name": "tool-patch", "nonce": True, "request": {**tool, "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Add a function buf_putc_n(buf *b, char c, size_t n) to buf.c that "
                                        "appends c n times. Use apply_patch."},
            call("c1", "read_file", {"path": "buf.c"}), result("c1", buf),
            call("c2", "grep", {"pattern": "buf_putc", "path": "."}),
            result("c2", "buf.c:  void buf_putc(buf *b, char c)\nbuf.h:  void buf_putc(buf *b, char c);")]}},
        {"name": "sampled-code", "nonce": True, "request": {
            "thinking": {"type": "disabled"}, "temperature": 0.7, "top_p": 1.0, "max_tokens": 384,
            "messages": [{"role": "user", "content": "Write a small C module implementing a ring buffer "
                                                     "of bytes with init, push, pop and free functions."}]}},
        {"name": "sample", "nonce": False, "samples": 40, "request": {
            "thinking": {"type": "disabled"}, "temperature": 1.0, "top_p": 1.0, "max_tokens": 16,
            "messages": [{"role": "user", "content": "Name six random animals, comma separated, nothing else."}]}},
    ]
    return {"schema_version": 1, "scenarios": scenarios}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    pathlib.Path(a.out).write_text(json.dumps(build(), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
