# Build & Deploy

This page documents the build system, scripts, and deployment workflow for DS4 Studio.

---

## Makefile Targets

The `Makefile` (15,401 bytes) defines build targets for Metal (macOS), CUDA (NVIDIA), and ROCm (AMD) backends.

| Target | Backend | Description |
|--------|---------|-------------|
| `make metal` | Metal | Build for macOS with Metal GPU graph driver |
| `make cuda` | CUDA | Build for NVIDIA CUDA GPUs |
| `make rocm` | ROCm | Build for AMD ROCm (Strix Halo, gfx1151) |
| `make strix-halo` | ROCm | Alias for `make rocm` |
| `make cpu` | CPU | CPU-only build (no GPU acceleration) |
| `make clean` | — | Remove build artifacts |

Key binaries produced:

| Binary | Description |
|--------|-------------|
| `./ds4` | CLI inference binary |
| `./ds4-server` | HTTP server binary |
| `./ds4-agent` | Native CLI agent binary |
| `./ds4-wrapper` | Session multiplexing wrapper |
| `./ds4-eval` | Evaluation/benchmark binary |
| `./ds4-bench` | Performance benchmark binary |

### Build Notes

- ROCm builds require `-cxx-isystem /opt/rocm-7.2.4/include` for correct header priority (see `AGENTS_BUILD.md`)
- GPU targets must list `ds4_crawl_grounding.o` in prerequisites — both Metal and GPU targets
- New `.c` files must be added to both Metal and GPU sections with compilation rules

---

## srun.sh

The main entrypoint script (`srun.sh`, 12,917 bytes) handles building and running the full stack.

### Commands

| Command | Description |
|---------|-------------|
| `./srun.sh` | Start web GUI and managed backend |
| `./srun.sh build` | Build ROCm binaries + frontend |
| `./srun.sh build be` | Build ROCm binaries only |
| `./srun.sh build fe` | Build frontend assets (vite build) |
| `./srun.sh clean` | Remove build artifacts |
| `./srun.sh stop` | Stop frontend and backend processes |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DS4_MODEL_VARIANT` | `q2-imatrix` | Model variant when downloading |
| `DS4_SERVER_FAST_FULL` | `1` | Enable max-performance ROCm preset |
| `DS4_SERVER_PERFLEVEL` | — | ROCm performance level (`high`, `auto`, `off`) |
| `ROCM_ARCH` | `gfx1151` | ROCm GPU architecture target |

---

## Scripts Directory

| Script | Description |
|--------|-------------|
| `scripts/rocm_settings.sh` | ROCm environment setup and quality decode defaults |
| `scripts/srun_tuning_gui.py` | Python startup tuning window for ROCm parameters |
| `scripts/rocm_progressive_perf_drift.sh` | Performance drift measurement over time |
| `scripts/certify_tool_compression.sh` | Tool compression certification tests |
| `scripts/certify_tool_compression_model_backed.sh` | Model-backed compression certification |
| `scripts/certify_tool_compression_operational.sh` | Operational compression certification |
| `scripts/certify_tool_compression_real_corpus.sh` | Real corpus compression certification |
| `scripts/build_tool_compression_evidence_report.py` | Generate compression evidence reports |

---

## Test Scripts

| Script | Description |
|--------|-------------|
| `test_loop_guard.sh` | Loop guard integration tests |
| `simulate_loop_guard.sh` | Loop guard simulation |
| `test_gitnexus_integration.sh` | GitNexus policy integration tests |
| `certify_all.sh` | Run all certification tests |

---

## Frontend Build

The frontend uses Vite (`vite.config.js`) with React and builds to `frontend/dist/`. Run `./srun.sh build fe` or `npm run build` from the frontend directory.

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `Makefile` | 15,401 | Build targets and compilation rules |
| `srun.sh` | 12,917 | Build/run orchestration script |
| `scripts/rocm_settings.sh` | 15,588 | ROCm environment setup |
| `scripts/srun_tuning_gui.py` | 24,464 | Tuning GUI utility |
| `frontend/vite.config.js` | 182 | Vite configuration |
