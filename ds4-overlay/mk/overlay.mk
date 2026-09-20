# mk/overlay.mk - DS4 overlay build rules.
#
# Included by the GENERATED Makefile.overlay inside the shadow tree, always
# AFTER the upstream Makefile.  Rules here must therefore be additive: no
# upstream recipe is redefined, so `make -f Makefile.overlay <upstream-target>`
# behaves exactly as upstream does.
#
# Everything downstream-specific gets an `overlay-` prefix, so an upstream that
# later grows a target of the same name never collides with this file.

DS4_OVERLAY_TARGETS := \
    overlay-strix-halo \
    overlay-strix-halo-rebuild \
    overlay-test-rocm \
    overlay-test-deepseek41 \
    overlay-test-agent \
    overlay-test-server \
    overlay-status

.PHONY: $(DS4_OVERLAY_TARGETS) \
        overlay-test-deepseek41-rocm overlay-test-deepseek41-memory \
        overlay-test-deepseek41-cache-spans

overlay-status:
	@echo "upstream : $(DS4_UPSTREAM)"
	@echo "overlay  : $(DS4_OVERLAY)"
	@echo "shadow   : $(DS4_SHADOW)"
	@echo "targets  : $(DS4_OVERLAY_TARGETS)"

# -----------------------------------------------------------------------------
# Build.  Upstream already provides `strix-halo`; the overlay target exists so
# recursive $(MAKE) keeps using the generated Makefile and therefore keeps the
# overlay objects and flags.
# -----------------------------------------------------------------------------
# Incremental by default: ds4_rocm.o alone is a ~10 minute HIP compile, and the
# shadow is regenerated per upstream sha anyway.  Use overlay-strix-halo-rebuild
# for the forced variant when switching backends.
# ds4_engram.o is absent from upstream's ROCm object set because upstream has
# no ROCm V4.1 path and therefore never needed Engram. Feature rocm-deepseek41
# does, so it joins the set here.
DS4_OVERLAY_ROCM_VARS = \
		CORE_OBJS="ds4.o ds4_image.o ds4_distributed.o ds4_tp.o ds4_ssd.o ds4_rocm.o ds4_rocm_compat.o ds4_rocm_unavailable.o ds4_layer_pack.o ds4_engram.o $(ROCM_MMQ_OBJS)" \
		CFLAGS="$(CFLAGS) $(ROCM_HOST_CFLAGS) -DDS4_ROCM_BUILD" \
		DS4_LINK="$(HIPCC) $(ROCM_CFLAGS)" \
		DS4_LINK_LIBS="$(ROCM_LDLIBS)"

overlay-strix-halo:
	$(MAKE) -f Makefile.overlay ds4 ds4-server ds4-bench ds4-eval ds4-agent $(DS4_OVERLAY_ROCM_VARS)

# ds4-wrapper is DS4 Studio's layer, so it builds from Makefile.studio rather
# than Makefile.overlay. ROCm is selected purely by these variable overrides --
# there is no GPU_BACKEND switch -- so without them the build falls through to
# the CUDA rule and dies on a missing nvcc.
# Makefile.studio reaches its own headers via "CFLAGS += -I. -I$(STUDIO_DIR)",
# and a command-line CFLAGS= override beats that +=, so the include paths have
# to be repeated here or every studio/*_ext.c fails on a missing runtime header.
overlay-strix-halo-wrapper:
	$(MAKE) -f Makefile.studio ds4-wrapper \
		CORE_OBJS="ds4.o ds4_image.o ds4_distributed.o ds4_tp.o ds4_ssd.o ds4_rocm.o ds4_rocm_compat.o ds4_rocm_unavailable.o ds4_layer_pack.o ds4_engram.o $(ROCM_MMQ_OBJS)" \
		CFLAGS="$(CFLAGS) $(ROCM_HOST_CFLAGS) -DDS4_ROCM_BUILD -I. -Istudio" \
		DS4_LINK="$(HIPCC) $(ROCM_CFLAGS)" \
		DS4_LINK_LIBS="$(ROCM_LDLIBS)"

overlay-strix-halo-rebuild:
	$(MAKE) -f Makefile.overlay -B ds4 ds4-server ds4-bench ds4-eval ds4-agent \
		CORE_OBJS="ds4.o ds4_image.o ds4_distributed.o ds4_tp.o ds4_ssd.o ds4_rocm.o ds4_rocm_compat.o ds4_rocm_unavailable.o ds4_layer_pack.o $(ROCM_MMQ_OBJS)" \
		CFLAGS="$(CFLAGS) $(ROCM_HOST_CFLAGS) -DDS4_ROCM_BUILD" \
		DS4_LINK="$(HIPCC) $(ROCM_CFLAGS)" \
		DS4_LINK_LIBS="$(ROCM_LDLIBS)"

overlay-test-rocm:
	$(MAKE) -f Makefile.overlay test-rocm

# -----------------------------------------------------------------------------
# DeepSeek V4.1 checks that exist only downstream.  Upstream carries the V4.1
# feature itself now, but not these three harnesses.
# -----------------------------------------------------------------------------
ds4_image.rocm.o: ds4_image.c ds4_image.h third_party/iris/jpeg.h third_party/iris/png.h
	$(CC) $(CFLAGS) $(ROCM_HOST_CFLAGS) -DDS4_ROCM_BUILD -c -o $@ $<

# CPU references compile without fast-math; the production GPU objects link in
# unchanged.  The executable name is what the Halo workload watcher looks for.
tests/test_deepseek41_rocm.o: tests/test_deepseek41_rocm.c ds4_gpu.h
	$(CC) $(filter-out -ffast-math,$(CFLAGS)) -ffp-contract=off $(ROCM_HOST_CFLAGS) -DDS4_ROCM_BUILD -I. -c -o $@ $<

ds4-kernel-v41: tests/test_deepseek41_rocm.o ds4_rocm.o ds4_image.rocm.o $(ROCM_MMQ_OBJS)
	$(HIPCC) $(ROCM_CFLAGS) -o $@ $^ $(ROCM_LDLIBS)

overlay-test-deepseek41-rocm: ds4-kernel-v41
	./ds4-kernel-v41

ifeq ($(UNAME_S),Linux)
overlay-test-deepseek41-memory: tests/test_deepseek41_memory.c ds4.c ds4.h ds4_gpu.h ds4_linux_memory.h
	@set -eu; \
	test_bin=$$(mktemp "$${TMPDIR:-/tmp}/ds4-memory.XXXXXX"); \
	trap 'rm -f "$$test_bin"' EXIT; \
	$(CC) $(filter-out -ffast-math,$(CFLAGS)) -O0 -UNDEBUG -UDS4_NO_GPU -DDS4_ROCM_BUILD \
		-Wno-unused-function -ffunction-sections -fdata-sections -I. \
		tests/test_deepseek41_memory.c -Wl,--gc-sections $(LDLIBS) -o "$$test_bin"; \
	"$$test_bin"

# Exercise the real accelerator span builders on sparse GGUFs without a GPU
# library, production object rebuild, or model allocation. Keep both branches.
overlay-test-deepseek41-cache-spans: tests/test_deepseek41_cache_spans.c ds4.c ds4.h ds4_gpu.h ds4_engram.h
	@set -eu; \
	test_dir=$$(mktemp -d "$${TMPDIR:-/tmp}/ds4-cache-spans.XXXXXX"); \
	trap 'rm -f "$$test_dir/generic" "$$test_dir/rocm"; rmdir "$$test_dir"' EXIT; \
	$(CC) $(filter-out -ffast-math,$(CFLAGS)) -O0 -UNDEBUG -UDS4_NO_GPU -UDS4_ROCM_BUILD \
		-Wno-unused-function -ffunction-sections -fdata-sections -I. \
		tests/test_deepseek41_cache_spans.c -Wl,--gc-sections $(LDLIBS) -o "$$test_dir/generic"; \
	"$$test_dir/generic"; \
	$(CC) $(filter-out -ffast-math,$(CFLAGS)) -O0 -UNDEBUG -UDS4_NO_GPU -DDS4_ROCM_BUILD \
		-Wno-unused-function -ffunction-sections -fdata-sections -I. \
		tests/test_deepseek41_cache_spans.c -Wl,--gc-sections $(LDLIBS) -o "$$test_dir/rocm"; \
	"$$test_dir/rocm"
else
overlay-test-deepseek41-memory overlay-test-deepseek41-cache-spans:
	@echo "$@: Linux-only, skipped on $(UNAME_S)"
endif

overlay-test-deepseek41: overlay-test-deepseek41-memory \
                         overlay-test-deepseek41-cache-spans \
                         overlay-test-deepseek41-rocm

overlay-test-agent:
	$(MAKE) -f Makefile.overlay ds4_agent_test
	./ds4_agent_test

overlay-test-server:
	$(MAKE) -f Makefile.overlay ds4_test
	./ds4_test --server
