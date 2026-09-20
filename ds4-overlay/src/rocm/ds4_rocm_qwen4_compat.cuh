/* overlay rocm-qwen4-enable: the handful of helpers ds4_qwen4_cuda.cuh expects
 * from ds4_cuda.cu, provided for the ROCm translation unit.
 *
 * ds4_cuda.cu defines these above its own #include of ds4_qwen4_cuda.cuh, so
 * the Qwen kernels compile there for free. ds4_rocm.cu has no such preamble:
 * enabling DS4_HAS_QWEN4_GPU produced 205 errors from exactly six undeclared
 * identifiers (192 of them a single one) plus one static assertion.
 *
 * Every shim below is the single-GPU reduction of the CUDA original. That is
 * not a simplification for convenience: the engine gate this feature opens
 * rejects multi-GPU outright (gpu_cfg->n_gpus > 1 and cuda_tensor_parallel are
 * both refused alongside ROCm), so the multi-device branches are unreachable
 * here by construction rather than by assumption.
 */
#ifndef DS4_ROCM_QWEN4_COMPAT_CUH
#define DS4_ROCM_QWEN4_COMPAT_CUH

/* ds4_cuda.cu picks between a capture stream and a shared V4.1 stream. The
 * ROCm launchers all use the default stream -- the rocm .cuh launches carry no
 * stream argument at all -- so returning 0 is what the surrounding ROCm code
 * already does, not a behaviour change smuggled in through a shim. */
static inline cudaStream_t cuda_decode_stream(void) { return (cudaStream_t)0; }

/* rocm/ds4_rocm_runtime.cuh already owns the one handle this build has. */
static inline cublasHandle_t cuda_cublas_for_tier(int logical_tier) {
    (void)logical_tier;
    return g_cublas;
}

/* Upstream tests prop.major >= 8, i.e. NVIDIA Ampere or newer, to enable a
 * token-tile attention path. Compute capability has no AMD meaning, and
 * claiming the path works here would be inventing a capability we have not
 * measured. Returning 0 keeps the generic path, which is the conservative
 * direction: slower if anything, never wrong. Revisit with a benchmark, not
 * with a guess. */
static inline int ds4_cuda_attn_tokentile_arch_ok(void) { return 0; }

/* Single GPU: no tier bias, no per-device remap. cuda_model_range_ptr is the
 * ROCm one from rocm/ds4_rocm_runtime.cuh, including the bounds check the
 * model-span-bounds feature adds to it. */
static inline const char *cuda_resolve_weight_ptr(const void *model_map,
                                                  uint64_t offset,
                                                  uint64_t bytes,
                                                  int logical_tier,
                                                  const char *label) {
    (void)logical_tier;
    return cuda_model_range_ptr(model_map, offset, bytes, label);
}

#ifndef CUBLAS_COMPUTE_32F_PEDANTIC
#define CUBLAS_COMPUTE_32F_PEDANTIC CUBLAS_COMPUTE_32F
#endif

/* HIP spells it __hip_bfloat16 and says so in the diagnostic. */
#ifndef __nv_bfloat16
#define __nv_bfloat16 __hip_bfloat16
#endif

#endif /* DS4_ROCM_QWEN4_COMPAT_CUH */
