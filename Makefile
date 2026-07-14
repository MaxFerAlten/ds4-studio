CC ?= cc
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
NATIVE_CPU_FLAG ?= -mcpu=native
else
NATIVE_CPU_FLAG ?= -march=native
endif

DEBUG_FLAGS ?= -g
CFLAGS ?= -O3 $(DEBUG_FLAGS) $(NATIVE_CPU_FLAG) -Wall -Wextra -std=c99 -funroll-loops -flto
LDFLAGS ?= -flto
OBJCFLAGS ?= -O3 $(DEBUG_FLAGS) $(NATIVE_CPU_FLAG) -Wall -Wextra -fobjc-arc

LDLIBS ?= -lm -pthread
METAL_SRCS := $(wildcard metal/*.metal)
ROCM_SRCS := $(wildcard rocm/*.cuh)
BUF_OBJS = buf.o

# ds4-wrapper objects.  The server/agent runtimes textually #include
# ds4_server.c / ds4_agent.c, so we must NOT also link ds4_server.o / ds4_agent.o
# (that would duplicate every symbol).  Core objects are added by the link rule.
WRAPPER_OBJS = ds4_wrapper.o ds4_wrapper_config.o ds4_wrapper_state.o \
               ds4_wrapper_http.o ds4_wrapper_metrics.o \
               ds4_server_runtime.o ds4_agent_runtime.o ds4_agent_session_store.o \
               ds4_context_blob.o ds4_tool_compress.o \
               ds4_help.o ds4_web.o ds4_kvstore.o linenoise.o rax.o

ifeq ($(UNAME_S),Darwin)
METAL_LDLIBS := $(LDLIBS) -framework Foundation -framework Metal
CORE_OBJS = ds4.o ds4_distributed.o ds4_ssd.o ds4_metal.o
CPU_CORE_OBJS = ds4_cpu.o ds4_distributed.o ds4_ssd.o
else
CFLAGS += -D_GNU_SOURCE -fno-finite-math-only
CUDA_HOME ?= /usr/local/cuda
NVCC ?= $(CUDA_HOME)/bin/nvcc
CUDA_ARCH ?=
ifneq ($(strip $(CUDA_ARCH)),)
NVCC_ARCH_FLAGS := -arch=$(CUDA_ARCH)
endif
NVCCFLAGS ?= -O3 -g -lineinfo --use_fast_math $(NVCC_ARCH_FLAGS) -Xcompiler $(NATIVE_CPU_FLAG) -Xcompiler -pthread
CORE_OBJS = ds4.o ds4_distributed.o ds4_ssd.o ds4_cuda.o
CPU_CORE_OBJS = ds4_cpu.o ds4_distributed.o ds4_ssd.o
CUDA_LDLIBS ?= -lm -Xcompiler -pthread -L$(CUDA_HOME)/targets/sbsa-linux/lib -L$(CUDA_HOME)/lib64 -lcudart -lcublas
HIPCC ?= $(shell command -v hipcc 2>/dev/null || echo /opt/rocm/bin/hipcc)
ROCM_ARCH ?= gfx1151
ROCM_CFLAGS ?= -O3 -ffast-math -g -fno-finite-math-only -pthread -D__HIP_PLATFORM_AMD__ -D__AMDGCN_WAVEFRONT_SIZE=64 -I/tmp/rocm-headers -cxx-isystem /opt/rocm-7.2.4/include -L/opt/rocm-7.2.4/lib -Wno-unused-command-line-argument -Wno-\#pragma-messages --offload-arch=$(ROCM_ARCH)
ROCM_LDLIBS ?= -lm -pthread -lhipblas -lhipblaslt
DS4_LINK ?= $(NVCC) $(NVCCFLAGS)
DS4_LINK_LIBS ?= $(CUDA_LDLIBS)
METAL_LDLIBS := $(LDLIBS)

# srun.sh performs incremental single-target ROCm builds via
# `make <target> GPU_BACKEND=rocm ROCM_ARCH=...` (no `make -B`).  Mirror the
# strix-halo overrides here so those invocations compile/link correctly without
# going through the recursive strix-halo target.
ifeq ($(GPU_BACKEND),rocm)
# gcc slim-LTO objects are invisible to hipcc's ld.lld: strip -flto so C
# objects link with the HIP toolchain (same reason as the strix-halo target).
CFLAGS := $(filter-out -flto,$(CFLAGS))
CFLAGS += -DDS4_ROCM_BUILD
CORE_OBJS = ds4.o ds4_distributed.o ds4_ssd.o ds4_rocm.o
DS4_LINK = $(HIPCC) $(ROCM_CFLAGS)
DS4_LINK_LIBS = $(ROCM_LDLIBS)
endif
endif

.PHONY: all help clean test cpu cuda cuda-spark cuda-generic cuda-regression strix-halo rocm ds4-crawl-grounding-test test-skill-autoload certify-skill-autoload

ifeq ($(UNAME_S),Darwin)
all: ds4 ds4-server ds4-bench ds4-eval ds4-agent

help:
	@echo "DS4 build targets:"
	@echo "  make              Build Metal ./ds4, ./ds4-server, ./ds4-bench, ./ds4-eval, and ./ds4-agent"
	@echo "  make cpu          Build CPU-only ./ds4, ./ds4-server, ./ds4-bench, ./ds4-eval, and ./ds4-agent"
	@echo "  make test         Build and run tests"
	@echo "  make clean        Remove build outputs"

ds4: ds4_cli.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o linenoise.o $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_cli.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o linenoise.o $(CORE_OBJS) $(METAL_LDLIBS)

ds4-server: ds4_server.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_server.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS) $(METAL_LDLIBS)

ds4-bench: ds4_bench.o ds4_help.o $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_bench.o ds4_help.o $(CORE_OBJS) $(METAL_LDLIBS)

ds4-eval: ds4_eval.o ds4_help.o $(BUF_OBJS) $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_eval.o ds4_help.o $(BUF_OBJS) $(CORE_OBJS) $(METAL_LDLIBS)

ds4-agent: ds4_agent.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_agent.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CORE_OBJS) $(METAL_LDLIBS)

ds4-wrapper: $(WRAPPER_OBJS) ds4_crawl_client.o ds4_crawl_grounding.o $(BUF_OBJS) $(CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(WRAPPER_OBJS) ds4_crawl_client.o ds4_crawl_grounding.o $(BUF_OBJS) $(CORE_OBJS) $(METAL_LDLIBS)

cpu: ds4_cli_cpu.o ds4_server_cpu.o ds4_bench_cpu.o ds4_eval_cpu.o ds4_agent_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o rax.o $(CPU_CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4 ds4_cli_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o linenoise.o $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-server ds4_server_cpu.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-bench ds4_bench_cpu.o ds4_help.o $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-eval ds4_eval_cpu.o ds4_help.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-agent ds4_agent_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)

cuda-regression:
	@echo "cuda-regression requires a CUDA build"
else
all: help

help:
	@echo "DS4 build targets:"
	@echo "  make cuda-spark          Build CUDA for DGX Spark / GB10"
	@echo "  make cuda-generic        Build CUDA for a generic local CUDA GPU"
	@echo "  make cuda CUDA_ARCH=sm_N Build CUDA with an explicit nvcc -arch value"
	@echo "  make strix-halo          Build ROCm for Strix Halo / gfx1151"
	@echo "  make rocm                Alias for make strix-halo"
	@echo "  make cpu                 Build CPU-only ./ds4, ./ds4-server, ./ds4-bench, ./ds4-eval, and ./ds4-agent"
	@echo "  make test                Build and run tests"
	@echo "  make clean               Remove build outputs"

cuda-spark:
	$(MAKE) -B ds4 ds4-server ds4-bench ds4-eval ds4-agent ds4-wrapper CUDA_ARCH=

cuda-generic:
	$(MAKE) -B ds4 ds4-server ds4-bench ds4-eval ds4-agent ds4-wrapper CUDA_ARCH=native

cuda:
	@if [ -z "$(strip $(CUDA_ARCH))" ]; then \
		echo "error: specify CUDA_ARCH, for example: make cuda CUDA_ARCH=sm_120"; \
		echo "       or use make cuda-spark / make cuda-generic"; \
		exit 2; \
	fi
	$(MAKE) -B ds4 ds4-server ds4-bench ds4-eval ds4-agent ds4-wrapper CUDA_ARCH="$(CUDA_ARCH)"

strix-halo:
	$(MAKE) -B ds4 ds4-server ds4-bench ds4-eval ds4-agent ds4-wrapper \
		CORE_OBJS="ds4.o ds4_distributed.o ds4_ssd.o ds4_rocm.o" \
		CFLAGS="$(filter-out -flto, $(CFLAGS)) -DDS4_ROCM_BUILD" \
		DS4_LINK="$(HIPCC) $(ROCM_CFLAGS)" \
		DS4_LINK_LIBS="$(ROCM_LDLIBS)"

rocm: strix-halo

ds4: ds4_cli.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o linenoise.o $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

ds4-server: ds4_server.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

ds4-bench: ds4_bench.o ds4_help.o $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

ds4-eval: ds4_eval.o ds4_help.o $(BUF_OBJS) $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

ds4-agent: ds4_agent.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

ds4-wrapper: $(WRAPPER_OBJS) ds4_crawl_client.o ds4_crawl_grounding.o $(BUF_OBJS) $(CORE_OBJS)
	$(DS4_LINK) -o $@ $^ $(DS4_LINK_LIBS)

cpu: ds4_cli_cpu.o ds4_server_cpu.o ds4_bench_cpu.o ds4_eval_cpu.o ds4_agent_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o rax.o $(CPU_CORE_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4 ds4_cli_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o linenoise.o $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-server ds4_server_cpu.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-bench ds4_bench_cpu.o ds4_help.o $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-eval ds4_eval_cpu.o ds4_help.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o ds4-agent ds4_agent_cpu.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(LDLIBS)

cuda-regression: tests/cuda_long_context_smoke
	./tests/cuda_long_context_smoke
endif

ds4.o: ds4.c ds4.h ds4_ssd.h ds4_distributed.h ds4_gpu.h
	$(CC) $(CFLAGS) -c -o $@ ds4.c

ds4_ssd.o: ds4_ssd.c ds4_ssd.h
	$(CC) $(CFLAGS) -c -o $@ ds4_ssd.c

ds4_cli.o: ds4_cli.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h linenoise.h ds4_crawl_client.h ds4_crawl_grounding.h
	$(CC) $(CFLAGS) -c -o $@ ds4_cli.c

ds4_crawl_client.o: ds4_crawl_client.c ds4_crawl_client.h
	$(CC) $(CFLAGS) -c -o $@ ds4_crawl_client.c

ds4_crawl_grounding.o: ds4_crawl_grounding.c ds4_crawl_grounding.h
	$(CC) $(CFLAGS) -c -o $@ ds4_crawl_grounding.c

ds4_distributed.o: ds4_distributed.c ds4_distributed.h ds4.h ds4_ssd.h
	$(CC) $(CFLAGS) -c -o $@ ds4_distributed.c

ds4_help.o: ds4_help.c ds4_help.h
	$(CC) $(CFLAGS) -c -o $@ ds4_help.c

ds4_server.o: ds4_server.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h rax.h buf.h
	$(CC) $(CFLAGS) -c -o $@ ds4_server.c

ds4_bench.o: ds4_bench.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h
	$(CC) $(CFLAGS) -c -o $@ ds4_bench.c

ds4_eval.o: ds4_eval.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h buf.h
	$(CC) $(CFLAGS) -c -o $@ ds4_eval.c

ds4_agent.o: ds4_agent.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h ds4_web.h ds4_context_blob.h ds4_tool_compress.h ds4_crawl_client.h ds4_crawl_grounding.h linenoise.h
	$(CC) $(CFLAGS) -c -o $@ ds4_agent.c

ds4_context_blob.o: ds4_context_blob.c ds4_context_blob.h
	$(CC) $(CFLAGS) -c -o $@ ds4_context_blob.c

ds4_tool_compress.o: ds4_tool_compress.c ds4_tool_compress.h ds4_context_blob.h
	$(CC) $(CFLAGS) -c -o $@ ds4_tool_compress.c

ds4_web.o: ds4_web.c ds4_web.h
	$(CC) $(CFLAGS) -c -o $@ ds4_web.c

buf.o: buf.c buf.h
	$(CC) $(CFLAGS) -c -o $@ buf.c

ds4_kvstore.o: ds4_kvstore.c ds4_kvstore.h ds4.h ds4_ssd.h buf.h
	$(CC) $(CFLAGS) -c -o $@ ds4_kvstore.c

# ds4-wrapper sources. ds4_server_runtime.c / ds4_agent_runtime.c textually
# #include the server/agent monoliths, so they need -Wno-unused-function (the
# monoliths expose many statics the wrapper does not call) and depend on the .c.
ds4_wrapper.o: ds4_wrapper.c ds4_wrapper.h ds4_wrapper_config.h ds4_wrapper_state.h ds4_wrapper_http.h ds4_server_runtime.h ds4_agent_runtime.h
	$(CC) $(CFLAGS) -c -o $@ ds4_wrapper.c

ds4_wrapper_config.o: ds4_wrapper_config.c ds4_wrapper_config.h
	$(CC) $(CFLAGS) -c -o $@ ds4_wrapper_config.c

ds4_wrapper_state.o: ds4_wrapper_state.c ds4_wrapper_state.h ds4_wrapper.h ds4_wrapper_config.h ds4_agent_session_store.h ds4_agent_runtime.h
	$(CC) $(CFLAGS) -c -o $@ ds4_wrapper_state.c

ds4_wrapper_http.o: ds4_wrapper_http.c ds4_wrapper_http.h ds4_wrapper_metrics.h ds4_wrapper_state.h ds4_server_runtime.h ds4_agent_runtime.h
	$(CC) $(CFLAGS) -c -o $@ ds4_wrapper_http.c

ds4_wrapper_metrics.o: ds4_wrapper_metrics.c ds4_wrapper_metrics.h \
    ds4_server_runtime.h ds4_agent_runtime.h ds4_default_skills.h
	$(CC) $(CFLAGS) -c -o $@ ds4_wrapper_metrics.c

ds4_agent_session_store.o: ds4_agent_session_store.c ds4_agent_session_store.h ds4.h ds4_kvstore.h
	$(CC) $(CFLAGS) -c -o $@ ds4_agent_session_store.c

ds4_server_runtime.o: ds4_server_runtime.c ds4_server_runtime.h ds4_wrapper.h ds4.h ds4_kvstore.h ds4_server.c ds4_default_skills.h
	$(CC) $(CFLAGS) -Wno-unused-function -c -o $@ ds4_server_runtime.c

ds4_agent_runtime.o: ds4_agent_runtime.c ds4_agent_runtime.h ds4_wrapper.h ds4_agent_session_store.h ds4_agent.c ds4_crawl_client.h ds4_crawl_grounding.h ds4_default_skills.h
	$(CC) $(CFLAGS) -Wno-unused-function -c -o $@ ds4_agent_runtime.c

ds4_test.o: tests/ds4_test.c ds4_server.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h rax.h ds4_default_skills.h
	$(CC) $(CFLAGS) -Wno-unused-function -c -o $@ tests/ds4_test.c

ds4_agent_test.o: tests/ds4_agent_test.c ds4_agent.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h ds4_web.h ds4_crawl_client.h ds4_crawl_grounding.h linenoise.h ds4_default_skills.h
	$(CC) $(CFLAGS) -Wno-unused-function -c -o $@ tests/ds4_agent_test.c

tests/cuda_long_context_smoke.o: tests/cuda_long_context_smoke.c ds4_gpu.h
	$(CC) $(CFLAGS) -I. -c -o $@ tests/cuda_long_context_smoke.c

rax.o: rax.c rax.h rax_malloc.h
	$(CC) $(CFLAGS) -c -o $@ rax.c

linenoise.o: linenoise.c linenoise.h
	$(CC) $(CFLAGS) -c -o $@ linenoise.c

ds4_cpu.o: ds4.c ds4.h ds4_ssd.h ds4_distributed.h ds4_gpu.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4.c

ds4_cli_cpu.o: ds4_cli.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h linenoise.h ds4_crawl_client.h ds4_crawl_grounding.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4_cli.c

ds4_server_cpu.o: ds4_server.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h rax.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4_server.c

ds4_bench_cpu.o: ds4_bench.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4_bench.c

ds4_eval_cpu.o: ds4_eval.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4_eval.c

ds4_agent_cpu.o: ds4_agent.c ds4.h ds4_ssd.h ds4_distributed.h ds4_help.h ds4_kvstore.h ds4_web.h ds4_crawl_client.h ds4_crawl_grounding.h linenoise.h
	$(CC) $(CFLAGS) -DDS4_NO_GPU -c -o $@ ds4_agent.c

ds4_metal.o: ds4_metal.m ds4_gpu.h $(METAL_SRCS)
	$(CC) $(OBJCFLAGS) -c -o $@ ds4_metal.m

ds4_cuda.o: ds4_cuda.cu ds4_gpu.h ds4_iq2_tables_cuda.inc
	$(NVCC) $(NVCCFLAGS) -c -o $@ ds4_cuda.cu

ds4_rocm.o: ds4_rocm.cu ds4_gpu.h ds4_iq2_tables_cuda.inc $(ROCM_SRCS)
	$(HIPCC) $(ROCM_CFLAGS) -c -o $@ ds4_rocm.cu

tests/cuda_long_context_smoke: tests/cuda_long_context_smoke.o ds4_cuda.o
	$(NVCC) $(NVCCFLAGS) -o $@ $^ $(CUDA_LDLIBS)

ds4_test: ds4_test.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS)
ifeq ($(UNAME_S),Darwin)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_test.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS) $(METAL_LDLIBS)
else
	$(DS4_LINK) -o $@ ds4_test.o ds4_help.o ds4_kvstore.o rax.o $(BUF_OBJS) $(CORE_OBJS) $(DS4_LINK_LIBS)
endif

ds4_agent_test: ds4_agent_test.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CPU_CORE_OBJS)
ifeq ($(UNAME_S),Darwin)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_agent_test.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CPU_CORE_OBJS) $(METAL_LDLIBS)
else
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ ds4_agent_test.o ds4_help.o ds4_crawl_client.o ds4_crawl_grounding.o ds4_web.o ds4_kvstore.o ds4_context_blob.o ds4_tool_compress.o linenoise.o $(BUF_OBJS) $(CPU_CORE_OBJS) -lm -pthread
endif

test: ds4_test ds4_agent_test ds4-eval q4k-dot-test ds4-crawl-grounding-test
	./ds4-eval --self-test-extractors
	./ds4_agent_test
	./ds4_test

test-skill-autoload:
	./tests/test_skill_autoload.sh

certify-skill-autoload:
	./tests/certify_skill_autoload_live.sh

q4k-dot-test: tests/test_q4k_dot.c
	$(CC) -O2 -Wall -Wextra -std=c99 -o tests/test_q4k_dot tests/test_q4k_dot.c -lm -pthread
	./tests/test_q4k_dot

ds4-crawl-grounding-test: tests/ds4_crawl_grounding_test
	./tests/ds4_crawl_grounding_test

tests/ds4_crawl_grounding_test: tests/ds4_crawl_grounding_test.c ds4_crawl_grounding.c ds4_crawl_grounding.h
	$(CC) $(CFLAGS) -I. -o $@ tests/ds4_crawl_grounding_test.c ds4_crawl_grounding.c

clean:
	rm -f ds4 ds4-server ds4-bench ds4-eval ds4-agent ds4-wrapper ds4_cpu ds4_native ds4_server_test ds4_test ds4_agent_test tests/test_q4k_dot tests/ds4_crawl_grounding_test *.o tests/cuda_long_context_smoke tests/cuda_long_context_smoke.o
