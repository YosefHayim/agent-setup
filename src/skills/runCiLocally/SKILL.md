---
name: run-ci-locally
description: Use when GitHub Actions cannot run (billing block, no runner) and the repo's CI workflows must pass locally in Docker with act. Runs each job, reports pass or fail, then removes every container, volume, image and file the run made. Say "run CI locally", "run act", or "Actions are blocked".
type: flow
---

# Run CI locally

Run the repository's GitHub Actions workflows on this machine with [act](https://nektosact.com) in Docker, report each job, and leave nothing behind.

## Safety

- Other sessions share Docker. Remove only what this run made, selected by its run name and its clone path. Never run `docker system prune` or any other `prune`.
- Never print or store the GitHub token; pass it only as an act secret.

- Docker is running with enough memory for the heaviest job. A leg killed with exit 137 means Docker needs more memory.
- `act` is installed. Read its config file (`~/.actrc`, or `~/Library/Application Support/act/actrc` on macOS) for the runner image, for example `-P ubuntu-latest=catthehacker/ubuntu:act-latest`.
- On Apple silicon, use an arm64 runner image and pass `--container-architecture linux/arm64`. A config that pins `linux/amd64` runs every job under emulation, several times slower.
- `gh auth status` works. The token goes in as a secret, never into a file.
- Pick a run name used for everything this run creates: `CI_NAME="ci-<branch>-<short-sha>"`. Work files go in the session scratchpad, never in the repository and never in the system temp folder.

## Workflow

### Setup

1. **Plain clone, not a worktree.** A worktree's `.git` file breaks steps that run git inside the container.

   ```bash
   git clone --single-branch --branch <branch> <repo-path> "<scratchpad>/$CI_NAME"
   ```

   Commit in the repository and clone again; never commit inside the clone. `dorny/paths-filter` diffs against `origin/<branch>` when it exists, so it misses a commit made only in the clone.

2. **GitHub origin.** act reads `github.repository` from the clone's origin; a file-path origin breaks actions such as `dorny/paths-filter`.

   ```bash
   git -C "<scratchpad>/$CI_NAME" remote set-url origin https://github.com/<owner>/<repo>.git
   ```

3. **One act process per job.** Jobs in one act process race on the action cache. Run each job as its own leg with `-j <job>`. act also runs the jobs it `needs` in that leg, so give each leg its own workflow copy inside the clone, named `<CI_NAME>-<job>`, or the shared jobs collide on container names:

   ```bash
   sed "s/^name: .*/name: $CI_NAME-<job>/" .github/workflows/ci.yml > ".github/workflows/$CI_NAME-<job>.yml"
   ```

   Skip a gate job that only reads `needs.*.result`: the other legs already prove it.

4. **Own action cache per leg.** Concurrent runs corrupt a shared `~/.cache/act` ("reference not found", "EOF").

   ```bash
   cp -cR ~/.cache/act "<scratchpad>/$CI_NAME-cache-<job>"   # macOS copy-on-write; use cp -R elsewhere
   ```

5. **Event file.** For `pull_request`, write the event JSON to the scratchpad with the base and head of the branch, so changed-file tools (`dorny/paths-filter`, `vitest --changed`, `biome check --changed`) see the same diff as on GitHub:

   ```json
   {"pull_request":{"number":1,"head":{"ref":"<branch>","sha":"<git rev-parse HEAD>"},"base":{"ref":"main","sha":"<git merge-base origin/main HEAD>"}}}
   ```

### Node missing after a PATH step

In `catthehacker/ubuntu:act-latest`, node lives only in the tool cache. After a step that edits PATH (for example `pnpm/action-setup` before `setup-node`), the next JavaScript action fails with `exec: "node": executable file not found` (exit 127). Fix it with a derived runner image that links node into `/usr/local/bin`:

```dockerfile
FROM catthehacker/ubuntu:act-latest
RUN NODE_BIN=$(ls -d /opt/acttoolcache/node/*/*/bin | tail -n 1) \
 && for tool in node npm npx corepack; do ln -sf "$NODE_BIN/$tool" "/usr/local/bin/$tool"; done
```

Build it once as `act-runner-node:<date>` and run with `-P ubuntu-latest=act-runner-node:<date> --pull=false`.

### Job containers

`--pull=false` also skips images named in a job's `container:`. Pull each one once for the runner's platform, and keep it like a runner image:

```bash
docker pull --platform linux/arm64 mcr.microsoft.com/playwright:<version>
```

### Run

Start every leg in the background, then wait for all of them:

```bash
act pull_request -W ".github/workflows/$CI_NAME-<job>.yml" -j <job> -e "<scratchpad>/$CI_NAME-event.json" --rm \
  -P ubuntu-latest=act-runner-node:<date> --pull=false --container-architecture linux/arm64 \
  --action-cache-path "<scratchpad>/$CI_NAME-cache-<job>" --action-offline-mode \
  -s GITHUB_TOKEN="$(gh auth token)" \
  > "<scratchpad>/$CI_NAME-<job>.log" 2>&1
```

- Use the event the workflow really runs on: `pull_request` with the event file, `workflow_dispatch` for a manual full run, `push` only when the workflow has that trigger.
- Run about 6 legs at once at most, and keep test workers moderate (for example 4 Playwright workers under `ACT`). More causes CPU contention and test timeouts on a shared machine. Rerun one failed leg alone with `--matrix <key>:<value>`.
- Scripts inside the container write temp files to `$RUNNER_TEMP`, not the system temp folder.
- act has no artifact server, so `actions/upload-artifact` fails with `Unable to get the ACTIONS_RUNTIME_TOKEN`. When it runs only on failure, the first failing step above it is the cause.
- A step that cannot work under act (an action with broken outputs, a deploy) gets a stand-in step in the workflow copy that runs the same tool directly. List every stand-in in the report.

### Cleanup (always, also after a failure)

Remove only what this run made. Containers of called reusable workflows are named `act-<job>-<CalledWorkflow>-<job>-<hash>`, without `CI_NAME`, so select containers by their working directory, which is the clone path:

```bash
CLONE="<scratchpad>/$CI_NAME"
for container in $(docker ps -aq); do
  [ "$(docker inspect --format '{{.Config.WorkingDir}}' "$container")" = "$CLONE" ] || continue
  name=$(docker inspect --format '{{.Name}}' "$container" | tr -d /)
  docker rm -f "$container"
  docker volume rm "$name" "$name-env"
done
for volume in $(docker volume ls -q --filter "name=$CI_NAME"); do docker volume rm "$volume"; done
```

- **Images.** Before the run, save `docker images -q` to a scratchpad file. After it, remove only new `act-*` images the run built for Docker actions. Keep the runner images (the base image, `act-runner-node:<date>` and job container images): they are machine tooling reused by every run.
- **Shared volumes.** Keep `act-toolcache` and any volume without `CI_NAME` in its name.
- **Files.** Delete the clone, the workflow copies, the leg caches, the event file and the logs from the scratchpad once the report is written.

Check that no container has the clone path as its working directory and that `docker volume ls --filter "name=$CI_NAME"` prints nothing.

## Verification

Report:

- The event, and which jobs ran and which were skipped by their `if`.
- Each leg: job, matrix values, pass or fail, duration, and for a failure the first failing step with a short log excerpt.
- Every stand-in step and why act could not run the original.
- Cleanup result: containers, volumes, images and files removed, and nothing left from this run.
