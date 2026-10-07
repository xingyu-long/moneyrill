#!/usr/bin/env python3
"""Small GitHub helper (no gh CLI needed). Uses the credential git already has for this repo.

  gh.py pr-create BRANCH "Title" [BODY_FILE]   open (or find) a pull request
  gh.py pr-merge NUMBER [--wait]               squash-merge, delete the branch. Merges when CI is green, or (without
                                               --wait) when this exact commit passed ship.sh --stage-only and CI has
                                               not failed; --wait waits up to 20 minutes for a green CI instead
  gh.py ci SHA                                 CI state of a commit (exit 0 green, 1 failed, 2 running or unknown)
  gh.py protect                                require PR + passing CI on main (if the plan allows)
  gh.py protection                             show whether main is protected
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

REQUIRED_CHECKS = ["check"]  # job names in .github/workflows/ci.yml
HISTORY = ".releases/history.log"  # ship.sh writes "VERIFIED <full sha>" here when a commit passed its local gate


def repo():
    url = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
    if not m:
        sys.exit("origin is not a GitHub repository")
    return m.group(1)


def token():
    out = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        text=True,
        capture_output=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    ).stdout
    cred = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if not cred.get("password"):
        sys.exit("No GitHub credential available to git; push once from a terminal to store one.")
    return cred["password"]


def api(method, path, body=None, ok=(200, 201, 204)):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo()}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {token()}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            data = json.loads(raw)
        except Exception:
            data = {"message": raw.decode()[:200]}
        return e.code, data


def pr_create(branch, title, body_file=None):
    if branch in ("main", "master"):
        sys.exit("Open pull requests from a branch, not from main.")
    owner = repo().split("/")[0]
    status, found = api("GET", f"/pulls?head={owner}:{branch}&state=open")
    if status == 200 and found:
        print(found[0]["html_url"], "(already open)")
        return
    if body_file and os.path.exists(body_file):
        body = open(body_file).read()
    else:
        commits = subprocess.check_output(
            ["git", "log", "origin/main..HEAD", "--format=- %s"], text=True
        ).strip()
        body = (
            "## What changed\n" + commits + "\n\n## Verification\n"
            "- [ ] `npm run check` passes (the pre-commit hook runs it)\n"
            "- [ ] Tried on staging (http://localhost:3002) with `./scripts/ship.sh --stage-only`\n"
            "- [ ] Database changes are additive (migration rehearsal covers production)\n"
        )
    status, pr = api("POST", "/pulls", {"title": title, "head": branch, "base": "main", "body": body})
    if status != 201:
        sys.exit(f"Could not open the pull request: {pr.get('message')} {pr.get('errors', '')}")
    print(pr["html_url"])


def ci_state(sha):
    status, data = api("GET", f"/commits/{sha}/check-runs?per_page=50")
    if status != 200:
        return "unknown", {}
    runs = {r["name"]: r for r in data.get("check_runs", [])}
    missing = [n for n in REQUIRED_CHECKS if n not in runs]
    if missing:
        return "pending", runs
    if any(runs[n]["status"] != "completed" for n in REQUIRED_CHECKS):
        return "pending", runs
    if all(runs[n]["conclusion"] == "success" for n in REQUIRED_CHECKS):
        return "success", runs
    return "failure", runs


def locally_verified(sha, log_path=HISTORY):
    """True when ship.sh --stage-only recorded this exact commit as having passed the local gate."""
    try:
        with open(log_path) as f:
            return any(line.rstrip("\n").endswith(f" VERIFIED {sha}") for line in f)
    except OSError:
        return False


def merge_decision(wait, local, ci):
    """('merge' | 'refuse', why). With --wait only a green CI merges. Otherwise a commit that passed the local
    gate merges while CI is still running, but never against a CI that has failed."""
    if ci == "success":
        return "merge", "CI is green"
    if wait:
        return "refuse", f"CI is {ci}"
    if ci == "failure":
        return "refuse", "CI failed on this commit, even though it passed the local gate"
    if local:
        return "merge", f"it passed the local gate (ship.sh --stage-only) and CI is {ci}"
    return "refuse", f"CI is {ci} and this commit has not passed the local gate (run ./scripts/ship.sh --stage-only on it)"


def pr_merge(number, wait):
    status, pr = api("GET", f"/pulls/{number}")
    if status != 200:
        sys.exit(f"Pull request {number} not found")
    if pr["state"] != "open":
        sys.exit(f"Pull request {number} is {pr['state']}")
    branch = pr["head"]["ref"]
    # Right after a push GitHub may still report the previous commit for a moment; wait until the pull
    # request points at the commit we pushed, so CI is judged for the right code.
    here = subprocess.run(["git", "rev-parse", "HEAD"], text=True, capture_output=True).stdout.strip()
    current = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True, capture_output=True).stdout.strip()
    if current == branch and here:
        for _ in range(30):
            status, pr = api("GET", f"/pulls/{number}")
            if pr["head"]["sha"] == here:
                break
            time.sleep(2)
        else:
            sys.exit("GitHub has not registered the pushed commit yet; try again in a moment.")
    sha = pr["head"]["sha"]
    deadline = time.time() + (20 * 60 if wait else 0)
    while True:
        state, runs = ci_state(sha)
        if state in ("success", "failure") or time.time() >= deadline:
            break
        time.sleep(15)
    summary = ", ".join(f"{n}: {r['conclusion'] or r['status']}" for n, r in runs.items()) or "none yet"
    verdict, why = merge_decision(wait, locally_verified(sha), state)
    if verdict != "merge":
        sys.exit(f"Not merging: {why} ({summary}). {pr['html_url']}")
    if state != "success":
        print(f"Merging without waiting for CI: {why}. CI keeps running; check it before promoting.")
    for _ in range(5):  # GitHub computes mergeability lazily
        status, pr = api("GET", f"/pulls/{number}")
        if pr.get("mergeable") is not None:
            break
        time.sleep(2)
    if pr.get("mergeable") is False:
        sys.exit("Not merging: the branch conflicts with main. Merge main into it and push again.")
    status, res = api(
        "PUT",
        f"/pulls/{number}/merge",
        {"merge_method": "squash", "commit_title": f"{pr['title']} (#{number})", "sha": sha},
    )
    if status != 200:
        sys.exit(f"Merge refused: {res.get('message')}")
    api("DELETE", f"/git/refs/heads/{branch}")
    print(f"Merged #{number} into main ({summary}); branch {branch} deleted on GitHub.")


def ci_command(sha):
    """Print the CI state of a commit. Exit 0 green, 1 failed, 2 still running or unknown."""
    try:
        state, runs = ci_state(sha)
    except (SystemExit, OSError, urllib.error.URLError) as e:  # no credential or no network: unknown, not failed
        print(f"CI on {sha[:7]}: unknown ({e})")
        sys.exit(2)
    summary = ", ".join(f"{n}: {r['conclusion'] or r['status']}" for n, r in runs.items()) or "none yet"
    print(f"CI on {sha[:7]}: {state} ({summary})")
    sys.exit({"success": 0, "failure": 1}.get(state, 2))


def protect():
    body = {
        "required_status_checks": {"strict": False, "contexts": REQUIRED_CHECKS},
        "enforce_admins": True,
        "required_pull_request_reviews": {"required_approving_review_count": 0},
        "restrictions": None,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "required_linear_history": True,
    }
    status, res = api("PUT", "/branches/main/protection", body)
    if status == 200:
        print("main is protected: pull request + passing CI required, no force pushes, admins included.")
    else:
        print(f"GitHub did not allow branch protection (HTTP {status}): {res.get('message')}")
        sys.exit(3)


def protection():
    status, res = api("GET", "/branches/main/protection")
    if status == 200:
        checks = res.get("required_status_checks", {}).get("contexts", [])
        print(f"main is protected. Required checks: {', '.join(checks) or 'none'}. Admins included: {res.get('enforce_admins', {}).get('enabled')}")
    else:
        print(f"main is NOT protected on GitHub ({res.get('message')})")
        sys.exit(3)


if __name__ == "__main__":
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "pr-create" and len(args) >= 2:
        pr_create(args[0], args[1], args[2] if len(args) > 2 else None)
    elif cmd == "pr-merge" and args:
        pr_merge(args[0], "--wait" in args)
    elif cmd == "ci" and args:
        ci_command(args[0])
    elif cmd == "protect":
        protect()
    elif cmd == "protection":
        protection()
    else:
        print(__doc__)
        sys.exit(2)
