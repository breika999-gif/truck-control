#!/usr/bin/env python3
"""
Crash Doctor — reads a GitHub issue (crash report), extracts affected files,
calls Claude API to generate a fix, commits to a new branch, opens a PR.
"""

import os
import re
import subprocess
import sys
import anthropic

ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
ISSUE_TITLE  = os.environ.get("ISSUE_TITLE", "")
ISSUE_BODY   = os.environ.get("ISSUE_BODY", "")
GH_TOKEN     = os.environ["GH_TOKEN"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

if not ANTHROPIC_API_KEY:
    print("ANTHROPIC_API_KEY is missing — skipping AI fix.")
    subprocess.run(["bash", "-c", 'echo "pr_url=" >> $GITHUB_OUTPUT'], check=False)
    sys.exit(0)

# ── 1. Extract source file paths from stack trace ─────────────────────────────
FILE_PATTERN = re.compile(r'((?:src|backend)[/\\][^\s:()]+\.(?:[tj]sx?|py)|App\.tsx|index\.js)')

def extract_files(text: str) -> list[str]:
    found = [f.replace("\\", "/") for f in FILE_PATTERN.findall(text)]
    # deduplicate, keep order
    seen: set[str] = set()
    result = []
    for f in found:
        if f not in seen and os.path.isfile(f):
            seen.add(f)
            result.append(f)
    return result[:6]  # cap at 6 files to stay within context

affected_files = extract_files(ISSUE_BODY)

if not affected_files:
    print("No recognisable source files in issue body — skipping.")
    subprocess.run(["bash", "-c",
        f'echo "pr_url=" >> $GITHUB_OUTPUT'], check=False)
    sys.exit(0)

# ── 2. Read file contents ─────────────────────────────────────────────────────
def read_file(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""

file_blocks = "\n\n".join(
    f"### {p}\n```\n{read_file(p)}\n```" for p in affected_files
)

# ── 3. Read AGENTS.md rules ───────────────────────────────────────────────────
agents_rules = ""
if os.path.isfile("AGENTS.md"):
    with open("AGENTS.md", encoding="utf-8") as f:
        agents_rules = f.read()

# ── 4. Call Claude API ────────────────────────────────────────────────────────
client = anthropic.Anthropic()

prompt = f"""You are TruckExpoAI Crash Doctor — an AI that fixes bugs in a React Native truck navigation app.

## AGENTS.md rules
{agents_rules}

## Crash report (GitHub issue #{ISSUE_NUMBER})
**Title:** {ISSUE_TITLE}

**Body / Stack trace:**
{ISSUE_BODY}

## Affected source files
{file_blocks}

## Task
1. Identify the root cause from the stack trace.
2. Produce a minimal, correct fix — do NOT refactor unrelated code.
3. For each file that needs changing, output a unified diff (diff -u format).
4. If the fix requires a new file, output the full file content.
5. End with a short PR description (2-3 sentences, plain text).

Output format:
```diff
--- a/path/to/file
+++ b/path/to/file
@@ ... @@
 context
-old line
+new line
```

PR_DESCRIPTION:
<your 2-3 sentence description here>
"""

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt}],
)

response_text = message.content[0].text
print("Claude response received.")

# ── 5. Extract diffs and PR description ──────────────────────────────────────
diff_blocks = re.findall(r'```diff\n(.*?)```', response_text, re.DOTALL)
pr_desc_match = re.search(r'PR_DESCRIPTION:\s*(.+?)(?:\n\n|\Z)', response_text, re.DOTALL)
pr_description = pr_desc_match.group(1).strip() if pr_desc_match else "AI-generated crash fix."

if not diff_blocks:
    print("No diffs found in Claude response — skipping PR.")
    subprocess.run(["bash", "-c", 'echo "pr_url=" >> $GITHUB_OUTPUT'], check=False)
    sys.exit(0)

# Only stack-trace source files may be changed. This enforces AGENTS.md even if
# the model suggests touching workflows, native projects, secrets, or config.
allowed_files = set(affected_files)
safe_diff_blocks = []
for diff_text in diff_blocks:
    changed_paths = {
        match.replace("\\", "/")
        for match in re.findall(r'^\+\+\+ b/(.+)$', diff_text, re.MULTILINE)
        if match != "/dev/null"
    }
    if changed_paths and changed_paths.issubset(allowed_files):
        safe_diff_blocks.append(diff_text)
    else:
        print(f"Rejected patch outside affected files: {sorted(changed_paths)}")

diff_blocks = safe_diff_blocks
if not diff_blocks:
    print("No policy-compliant diffs found — skipping PR.")
    subprocess.run(["bash", "-c", 'echo "pr_url=" >> $GITHUB_OUTPUT'], check=False)
    sys.exit(0)

# ── 6. Create branch and apply patches ───────────────────────────────────────
branch = f"codex/crash-fix-{ISSUE_NUMBER}"

subprocess.run(["git", "config", "user.name", "Crash Doctor"], check=True)
subprocess.run(["git", "config", "user.email", "crash-doctor@noreply.github.com"], check=True)
subprocess.run(["git", "checkout", "-b", branch], check=True)

for diff_text in diff_blocks:
    proc = subprocess.run(
        ["git", "apply", "--whitespace=fix", "-"],
        input=diff_text.encode(),
        capture_output=True,
    )
    if proc.returncode != 0:
        print(f"Patch failed: {proc.stderr.decode()}")

# ── 7. Commit ─────────────────────────────────────────────────────────────────
subprocess.run(["npm", "ci"], check=True)
subprocess.run(["npx", "tsc", "--noEmit"], check=True)
subprocess.run(["npm", "run", "lint"], check=True)
subprocess.run(["npm", "test", "--", "--passWithNoTests"], check=True)

subprocess.run(["git", "add", "-A"], check=True)
status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
if not status.stdout.strip():
    print("No changes after applying patch — skipping PR.")
    subprocess.run(["bash", "-c", 'echo "pr_url=" >> $GITHUB_OUTPUT'], check=False)
    sys.exit(0)

commit_msg = f"fix: crash-doctor auto-fix for issue #{ISSUE_NUMBER}\n\n{pr_description}"
subprocess.run(["git", "commit", "-m", commit_msg], check=True)

# ── 8. Push and open PR ───────────────────────────────────────────────────────
repo = os.environ.get("GITHUB_REPOSITORY", "")
push_url = f"https://x-access-token:{GH_TOKEN}@github.com/{repo}.git"
subprocess.run(["git", "push", push_url, branch], check=True)

pr_body = f"""## 🩺 Crash Doctor Auto-Fix

Closes #{ISSUE_NUMBER}

{pr_description}

---
**Affected files:** {', '.join(f'`{f}`' for f in affected_files)}

> ⚠️ AI-generated fix. Please review before merging. Never auto-merges to main.
"""

gh_result = subprocess.run(
    ["gh", "pr", "create",
     "--title", f"fix: crash-doctor #{ISSUE_NUMBER} — {ISSUE_TITLE[:60]}",
     "--body", pr_body,
     "--base", "main",
     "--head", branch,
     "--label", "crash-doctor"],
    capture_output=True, text=True,
    env={**os.environ, "GH_TOKEN": GH_TOKEN},
)

pr_url = gh_result.stdout.strip()
print(f"PR opened: {pr_url}")

with open(os.environ.get("GITHUB_OUTPUT", "/dev/null"), "a") as f:
    f.write(f"pr_url={pr_url}\n")
