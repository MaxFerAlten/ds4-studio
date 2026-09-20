# studio-app-layer — DS4 Studio on top of antirez/ds4

The rule is the overlay's: `ds4_agent.c`, `ds4_server.c` and `Makefile` are
never edited. Studio's changes to them are shadow patches in this repository,
applied at compose time by the same fail-closed applier as the engine patches.

```
ANTIREZ UPSTREAM                     DS4 STUDIO
────────────────                     ──────────

ds4_agent.c  ──┐
ds4_server.c ──┤ pristine
Makefile     ──┘
               │  copied to studio/, then patches/studio/*.patch (strict)
               ▼
     <shadow>/studio/ds4_*.c                   patched at compose time;
               │                               <shadow>/ds4_*.c stay upstream's
               │
               ▼
     ds4_*_runtime.c                           base adapter (textual include,
               │                               reaches upstream static helpers)
               ▼
     studio/ds4_*_ext.c                        policy / decorator
               │
               ▼
     ds4_wrapper                               Studio entry point
```

## Why three layers and not two

| change | home |
|---|---|
| request/turn policy, metrics, guards — anything expressible at the API surface | `studio/ds4_*_ext.c` |
| needs upstream's `static` helpers | `ds4_*_runtime.c` (includes the monolith) |
| edits the **inside** of an upstream function | `patches/studio/*.patch` |

The first two are ordinary C. Only the third needs machinery, because a
decorator in a separate translation unit cannot reach into the middle of
`generate_job()`.

`studio/ds4_upstream_compat.h` is the cheap half of the firewall: compile-time
assertions and symbol references, so a renamed or removed upstream symbol fails
at the contract instead of deep inside a textually-included monolith.

## Build

```
scripts/overlayctl.py compose
make -C "$(scripts/overlayctl.py shadow-path)" -f Makefile.overlay overlay-strix-halo-wrapper ROCM_ARCH=gfx1151
```

or just `./srun.sh build` in ds4. `GPU_BACKEND=rocm` does not exist: it falls
through to the CUDA rule and dies on a missing nvcc.

`Makefile.studio` refuses to run outside a composed shadow, and refuses a shadow
without `studio/ds4_agent.c`: either way it would link a wrapper with none of
the Studio edits, and link it without complaint.

The edited files are copies at `studio/` (the shadow_patch `from` key), not the
upstream-named files patched in place. ds4, ds4-server and ds4-agent build from
`ds4_*.c` through Makefile.overlay and must stay antirez's binaries; before the
migration they did, because the Studio copy was generated separately under
`build/studio/`, and patching in place would have ended that silently.

## Changing a Studio edit

Edit `studio/ds4_agent.c` in a composed shadow, then regenerate the patch:

```
scripts/make_patch.py ../ds4_agent.c \
    "$(scripts/overlayctl.py shadow-path)"/studio/ds4_agent.c --name studio/ds4_agent.c \
    > patches/studio/studio__ds4_agent.c.patch
```

`make_patch.py` starts each hunk at 3 lines of context and grows it until the
hunk's text occurs once in upstream. The patches are declared `strict`, so the
applier refuses any hunk that is not unique rather than letting the line number
choose between identical copies.

## Taking a new upstream

Upstream's history is this repository's own history: the import commit was
grafted onto antirez's `8db1d1d`, so a new upstream arrives as an ordinary
merge, not as a re-import. Two remotes, both read-only (their push URL is a
dead name on purpose — a push to `upstream` would rewrite the local clone's
`main`):

```
git pull antirez main      # straight from github.com/antirez/ds4
git pull upstream main     # only what the local clone already fetched
```

`upstream` is the local clone at `/mnt/crucial_ai/COPARATOR/ds4`, so it is the
one to use to stay on a revision already fetched and looked at there, and
`antirez` the one for whatever is current.

Studio never edits upstream's files, so such a merge touches only files nobody
here patches and goes through untouched. That separation is also what
`verify_upstream_clean.py` reads: a tracked file present in `upstream/main` is
upstream's and must be clean before a build, anything else is Studio's and is
edited directly. Without that ref (a clone with no remote) every tracked file
counts as upstream instead.

## After a `git pull`

The shadow is keyed by upstream SHA, so a pull always recomposes and every hunk
is checked against the new upstream. If it composes, there is nothing to do.

If it stops with `PATCH_FAIL`, upstream changed text inside a hunk. What changed
underneath it is one command, since `reviewed_sha` records the upstream the
patches were last checked against:

```
git diff <reviewed_sha> upstream/main -- ds4_agent.c
```

Fold that change into the Studio edit in a shadow composed at the old SHA,
regenerate with `make_patch.py`, update `reviewed_sha`.

### What the migration gave up

This layer used to be `studio/overlay/*.ops` applied by `studio/studio_overlay.py`.
Its `apply` and `verify` are covered exactly (byte-identical output, stricter
uniqueness). Two maintenance commands are not:

- **`reanchor`** rebuilt an anchor whose surrounding lines had changed, choosing
  among candidates by how much of the old neighbourhood survived. That is a
  closest-match heuristic, which the overlay policy forbids; its loss is
  deliberate. A hunk whose *line numbers* merely moved needs nothing: the
  applier finds unique text wherever it is.
- **`explain`** printed, per broken edit, how upstream changed under it. That
  was pure diagnosis and is a real loss. The `git diff` above gives the same
  information per file rather than per hunk.

The old tree is archived at
`/mnt/crucial_ai/COPARATOR/studio-backup-20260918-135529.tar.gz`.

## Tests

```
./tests/test_upstream_compat.sh     # in ds4: upstream pristine + every studio patch applies strictly
tests/test_make_patch.py            # here: generated hunks are unique and round-trip exactly
tests/test_exact_patch.py           # here: the applier, strict mode included
```
