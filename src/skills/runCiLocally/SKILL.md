---
name: run-ci-locally
description: Use when GitHub Actions cannot run (billing block, no runner) and the repo's CI workflows must pass locally in Docker with act. Runs each job, reports pass or fail, then removes every container, volume, image and file the run made. Say "run CI locally", "run act", or "Actions are blocked".
type: flow
---

# Run CI locally

Run the repository's GitHub Actions workflows on this machine with [act](https://nektosact.com) in Docker, report each job, and leave nothing behind.

## Safety

- Other sessions share Docker. Remove only what this run made, selected by its run name. Never run `docker system prune` or any other `prune`.
- Never print or store the GitHub token; pass it only as an act secret.

- Docker is running with enough memory for the heaviest job. A leg killed with exit 137 means Docker needs more memory.
- `act` is installed, and its config file `~/.actrc` holds the machine defaults, so no leg passes them. act also reads `~/Library/Application Support/act/actrc` on macOS before it, and the repository's own `.actrc` after it, which wins. So a repository `.actrc` holds only settings for that repository, never the runner image, the architecture or the pnpm store.

  ```text
  -P ubuntu-latest=act-runner-node:<date>
  -P ubuntu-slim=act-runner-node:<date>
  -P ubuntu-24.04=act-runner-node:<date>
  --pull=false
  --container-architecture=linux/<arch>
  --no-cache-server
  --network=bridge
  --container-options -v act-pnpm-store:/pnpm-store -v act-npm-cache:/root/.npm -v act-playwright:/ms-playwright -v act-turbo-cache:/turbo-cache
  --env=npm_config_store_dir=/pnpm-store
  --env=pnpm_config_store_dir=/pnpm-store
  --env=npm_config_unsafe_perm=true
  --env=pnpm_config_unsafe_perm=true
  --env=PLAYWRIGHT_SKIP_BROWSER_GC=1
  --env=TURBO_CACHE_DIR=/turbo-cache
  --env=TURBO_CACHE_MAX_AGE=7d
  --env=TURBO_CACHE_MAX_SIZE=20GB
  ```

  - Map every `runs-on` label the repositories use (`ubuntu-latest`, `ubuntu-slim`, `ubuntu-24.04`) to the runner image. An unmapped label falls back to a slow default image.
  - The architecture is the host's own: `arm64` with an arm64 runner image on Apple silicon, `amd64` on x86. `linux/amd64` on Apple silicon runs every job under emulation, several times slower.
  - `--network=bridge` gives each job container its own network. act's default puts every container on the Docker host network, so two legs that start a server on the same port fail with `EADDRINUSE`. A job with `services:` gets its own network either way. A step that needs a port published on the host (a database started outside act) reaches it at `host.docker.internal:<port>`. Docker Desktop provides that name; Docker Engine on Linux needs `--add-host=host.docker.internal:host-gateway` added to the `--container-options` line.
  - The Docker volume `act-pnpm-store` is one pnpm store for every run, so an install only links packages. Without it pnpm keeps its store inside the clone, whose path changes every run, so `actions/cache` never finds an earlier save: every leg downloads everything and saves another 600 MB entry to `~/.cache/actcache`. `--no-cache-server` turns those cache steps into quick misses. pnpm 10 reads `npm_config_*` and pnpm 11 only `pnpm_config_*`, so both are set. A bind mount of the host's own pnpm store is slower than the volume on macOS.
  - The Docker volume `act-npm-cache` is npm's download cache, so `npm ci` and the pnpm that `pnpm/action-setup` installs with npm download once, not in every leg. On a slow network, six legs each downloading pnpm time out.
  - act runs jobs as root, and pnpm running lifecycle scripts as root sets `TMPDIR` to `<repo>/node_modules/.tmp`. In a deep checkout that makes socket paths too long (`tsx` in a `prepare` script fails with `listen EINVAL`). GitHub runners are not root, so `unsafe_perm=true` matches them.
  - The Docker volume `act-playwright` is the browsers folder. Docker seeds a new named volume from the runner image's `/ms-playwright` on first use, so a `playwright install` of a version already there takes about 1s, not about 49s. `playwright install` also deletes every browser that no live install links to, and each run's clone is gone by the next run, so without `PLAYWRIGHT_SKIP_BROWSER_GC=1` every install wipes the browsers other repositories installed. Turbo's strict env mode drops `PLAYWRIGHT_BROWSERS_PATH` unless `globalPassThroughEnv` lists it, and its tasks then look in the default browsers folder.
  - The Docker volume `act-turbo-cache` is turbo's local cache. Each run is a new clone, so turbo's default `.turbo/cache` inside it is gone by the next run and every leg rebuilds everything. With `TURBO_CACHE_DIR` on the volume, a leg restores every task whose inputs did not change: a vybekiit build leg took 259s cold and 63s warm, with 33 of 33 tasks cached. Turbo writes each entry to a temporary file and then renames it, so parallel legs share the volume safely. Turbo never evicts local cache entries unless asked, so `TURBO_CACHE_MAX_AGE` and `TURBO_CACHE_MAX_SIZE` keep the volume from growing forever.
- `gh auth status` works. The token goes in as a secret, never into a file.
- Pick a run name used for everything this run creates: `CI_NAME="ci-<branch>-<short-sha>"`, with every `/` in the branch turned into `-`, because the name goes into `sed` and `perl` patterns and into container names. Work files go in the session scratchpad, never in the repository and never in the system temp folder.

## Workflow

### Setup

1. **Plain clone, not a worktree.** A worktree's `.git` file breaks steps that run git inside the container.

   ```bash
   git clone --single-branch --branch <branch> <repo-path> "<scratchpad>/$CI_NAME"
   ```

   Run every later command from inside the clone (`cd "<scratchpad>/$CI_NAME"`), so the relative paths never edit the repository's own workflows. Commit in the repository and clone again; never commit inside the clone. `dorny/paths-filter` diffs against `origin/<branch>` when it exists, so it misses a commit made only in the clone.

2. **GitHub origin.** act reads `github.repository` from the clone's origin; a file-path origin breaks actions such as `dorny/paths-filter`.

   ```bash
   git -C "<scratchpad>/$CI_NAME" remote set-url origin https://github.com/<owner>/<repo>.git
   ```

3. **Run name in every container name.** act names a container `act-<workflow name>-<job>`, and a called reusable workflow's container `act-<caller job>-<called workflow name>-<job>`, trimmed to 63 characters. Prefix every workflow name in the clone, so parallel runs of the same repository never collide and cleanup finds every container. Keep `CI_NAME` under 40 characters.

   ```bash
   perl -pi -e "s/^name: /name: $CI_NAME-/" .github/workflows/*.yml
   ```

   A test that checks a workflow is byte-identical to a copy elsewhere in the repository fails after this rename. Rename that copy the same way in the clone.

4. **One act process per job.** Jobs in one act process race on the action cache. Run each job as its own leg with `-j <job>`. act also runs the jobs it `needs` in that leg, so give each leg its own workflow copy, or the shared jobs collide:

   ```bash
   sed "s/^name: .*/name: $CI_NAME-<job>/" .github/workflows/ci.yml > ".github/workflows/$CI_NAME-<job>.yml"
   ```

   Skip a gate job that only reads `needs.*.result`: the other legs already prove it.

5. **Own action cache per leg.** Concurrent runs corrupt a shared `~/.cache/act` ("reference not found", "EOF").

   ```bash
   cp -cR ~/.cache/act "<scratchpad>/$CI_NAME-cache-<job>"   # macOS copy-on-write; use cp -R elsewhere
   ```

   When `~/.cache/act` lacks an action the workflow uses (a fresh setup, or a new action), run one leg once without `--action-offline-mode` and copy the caches after it.

6. **Event file.** For `pull_request`, write the event JSON to the scratchpad with the pull request's number, base and head, so changed-file tools (`dorny/paths-filter`, `vitest --changed`, `biome check --changed`) see the same diff as on GitHub. `gh pr view <branch> --json number,baseRefName` gives the number and the base branch. The single-branch clone has no `origin/<base>`, so run `git fetch origin <base>:refs/remotes/origin/<base>` first:

   ```json
   {"pull_request":{"number":<number>,"head":{"ref":"<branch>","sha":"<git rev-parse HEAD>"},"base":{"ref":"<base>","sha":"<git merge-base origin/<base> HEAD>"}}}
   ```

### Node missing after a PATH step

In `catthehacker/ubuntu:act-latest`, node lives only in the tool cache. After a step that edits PATH (for example `pnpm/action-setup` before `setup-node`), the next JavaScript action fails with `exec: "node": executable file not found` (exit 127). Fix it with a derived runner image that links node into `/usr/local/bin`:

```dockerfile
FROM catthehacker/ubuntu:act-latest
RUN NODE_BIN=$(ls -d /opt/acttoolcache/node/*/*/bin | tail -n 1) \
 && for tool in node npm npx corepack; do ln -sf "$NODE_BIN/$tool" "/usr/local/bin/$tool"; done
```

Build it once as `act-runner-node:<date>` and name it in the config's `-P` line.

### Job containers

`--pull=false` also skips images named in a job's `container:`. Pull each one once for the runner's platform, and keep it like a runner image:

```bash
docker pull --platform linux/<arch> mcr.microsoft.com/playwright:<version>
```

### Run

Start every leg in the background, then wait for all of them:

```bash
GITHUB_TOKEN="$(gh auth token)" node "<skill directory>/scripts/holdActSlot.mjs" -- \
  act pull_request -W ".github/workflows/$CI_NAME-<job>.yml" -j <job> \
  -e "<scratchpad>/$CI_NAME-event.json" --rm \
  --action-cache-path "<scratchpad>/$CI_NAME-cache-<job>" --action-offline-mode \
  -s GITHUB_TOKEN \
  > "<scratchpad>/$CI_NAME-<job>.log" 2>&1
```

- `-s GITHUB_TOKEN` without a value reads the variable, so the token stays out of act's arguments in the process list.

- Use the event the workflow really runs on: `pull_request` with the event file, `workflow_dispatch` for a manual full run, `push` only when the workflow has that trigger.
- On cold caches (a new pnpm version or lockfile), run one leg alone first and start the rest after it, so they reuse its downloads.
- The slots are shared by every session and account on the machine, so start all legs in the background and let the script queue them. It waits for a free slot (6 by default, `--slots <n>`), runs act, frees the slot when act exits, and exits with act's exit code. Do not cap the legs yourself.
- A job with a matrix (for example Playwright shards) runs one leg per entry with `--matrix <key>:<value>`, each leg with its own workflow copy, action cache and slot. Rerun one failed leg the same way.
- Keep test workers moderate (for example 4 Playwright workers under `ACT`). More causes CPU contention and test timeouts on a shared machine.
- Scripts inside the container write temp files to `$RUNNER_TEMP`, not the system temp folder.
- act has no artifact server, so `actions/upload-artifact` fails with `Unable to get the ACTIONS_RUNTIME_TOKEN`. When it runs only on failure, the first failing step above it is the cause.
- A step that cannot work under act (an action with broken outputs, a deploy) gets a stand-in step in the workflow copy that runs the same tool directly. List every stand-in in the report.

### Cleanup (always, also after a failure)

Remove only what this run made, selected by `CI_NAME`. `--rm` already removes most of it; this catches the rest.

```bash
for container in $(docker ps -aq --filter "name=$CI_NAME"); do docker rm -f "$container"; done
for volume in $(docker volume ls -q --filter "name=$CI_NAME"); do docker volume rm "$volume"; done
```

- **Slots.** Each slot is a local port from 28731 up that the script listens on while act runs, so the system frees it when the script exits or is killed. There is nothing to remove.
- **Images.** Before the run, save `docker images -q` to a scratchpad file. After it, remove only new `act-*` images the run built for Docker actions. Keep the runner images (the base image, `act-runner-node:<date>` and job container images): they are machine tooling reused by every run.
- **Shared volumes.** Keep `act-toolcache`, `act-pnpm-store`, `act-npm-cache`, `act-playwright`, `act-turbo-cache` and any volume without `CI_NAME` in its name.
- **Files.** Delete the clone, the leg caches, the event file and the logs from the scratchpad once the report is written.

Check that `docker ps -a --filter "name=$CI_NAME"` and `docker volume ls --filter "name=$CI_NAME"` print nothing.

## Verification

Report:

- The event, and which jobs ran and which were skipped by their `if`.
- Each leg: job, matrix values, pass or fail, duration, and for a failure the first failing step with a short log excerpt.
- Every stand-in step and why act could not run the original.
- Cleanup result: containers, volumes, images and files removed, and nothing left from this run.
