/*
 * Derived from DeepInfer (https://github.com/deepseek-ai/DeepInfer) commit 9bd9cf2,
 * csrc/engine/mtp_varlen.hpp, Apache-2.0. Modified: ported to C11 for DS4-Studio.
 */
#ifndef DS4DI_SPEC_POLICY_H
#define DS4DI_SPEC_POLICY_H

#include <stdbool.h>
#include <stdint.h>

#define DS4DI_MAX_SEQS 64u
#define DS4DI_MAX_DRAFT 16u
#define DS4DI_MEDIAN_WINDOW 9u
#define DS4DI_MEDIAN_MIN_SAMPLES 5u
#define DS4DI_PROMOTION_MIN_SAMPLES 16u
#define DS4DI_ACCEPTANCE_EMA_ALPHA 0.1

typedef enum {
    DS4DI_OK = 0,
    DS4DI_ERR_ARGUMENT = -1,
    DS4DI_ERR_LENGTH = -2,
    DS4DI_ERR_CONFIDENCE = -3,
    DS4DI_ERR_PROFILE = -4,
    DS4DI_ERR_OBSERVATION = -5
} ds4di_status;

typedef enum {
    DS4DI_REASON_SELECTED = 0,
    DS4DI_REASON_NO_PROFILE,
    DS4DI_REASON_BAD_CONFIDENCE,
    DS4DI_REASON_BAD_ARGUMENT
} ds4di_reason;

typedef struct {
    uint32_t draft_length;
    ds4di_reason reason;
} ds4di_spec_decision;

/* Errors zero *out. Only cond_p[0..m) is used; NULL is allowed when m == 0. */
int ds4di_expected_accepted(const double *cond_p, uint32_t n, uint32_t m,
                            double *out);

/* Validate every confidence in [0, min(n, max_supported)), even for missing
 * timings. times_ms[m] is the COMPLETE step cost, including drafting/sampling.
 * A zero-length array may be NULL. NO_PROFILE is a successful policy outcome;
 * bad arguments/confidence return negative status and a zero-length decision.
 * These two scalar APIs are not limited by DS4DI_MAX_DRAFT.
 */
int ds4di_choose_draft_length(const double *cond_p, uint32_t n,
                              const double *times_ms, const uint8_t *times_valid,
                              uint32_t n_times, uint32_t max_supported,
                              ds4di_spec_decision *out);
const char *ds4di_reason_name(ds4di_reason reason);

typedef struct {
    double samples[DS4DI_MEDIAN_WINDOW];
    uint32_t size;
    uint32_t next;
    uint64_t rejected_samples;
} ds4di_median_window;

/* Zero initialization is equivalent to init. Rejected samples do not evict. */
void ds4di_median_window_init(ds4di_median_window *window);
bool ds4di_median_window_update(ds4di_median_window *window, double sample_ms);
/* Unavailable/error zeroes *out. Finite negative samples are retained, as upstream. */
bool ds4di_median_window_get(const ds4di_median_window *window, double *out);

typedef struct {
    uint32_t graph_size;
    double baseline_ms;
} ds4di_curve_point;

typedef struct {
    /* CUMULATIVE prefix probabilities, not conditional probabilities.
     * Supply nonincreasing rates; use prefix products for conditional input.
     * n_rates is either zero (pad has_draft ? 1 : 0) or exactly n_drafts.
     */
    const double *rates;
    uint32_t n_rates;
    uint32_t n_drafts; /* Actual draft tokens already available to the caller. */
    bool has_draft;
} ds4di_seq_rates;

/* Strictly increasing graph sizes, finite positive baselines. Uses at most
 * DS4DI_MAX_SEQS * DS4DI_MAX_DRAFT ranked entries on the stack; no allocation.
 * Empty curve chooses all supplied drafts. Otherwise each query count costs
 * the FIRST graph_size >= total_q, plus max(0, slope_ms)*graph_size + sampler_ms.
 * On error, outputs are one per sequence when pointers/count are valid.
 * Single history serves budget selection AND allocation (no async ZOS).
 */
int ds4di_varlen_schedule(const ds4di_curve_point *curve, uint32_t n_curve,
                          double slope_ms, double sampler_ms,
                          const ds4di_seq_rates *seqs, uint32_t n_seqs,
                          uint32_t *seqlens_q_out);

typedef enum {
    DS4DI_STATE_DISABLED = 0,
    DS4DI_STATE_SHADOW,
    DS4DI_STATE_CANARY,
    DS4DI_STATE_ENABLED,
    DS4DI_STATE_FALLBACK
} ds4di_spec_state;

typedef enum {
    DS4DI_EVENT_ENABLE_SHADOW = 0,
    DS4DI_EVENT_PROMOTE_CANARY,
    DS4DI_EVENT_PROMOTE_ENABLED,
    DS4DI_EVENT_FAULT,
    DS4DI_EVENT_RESET,
    DS4DI_EVENT_MODEL_SWITCH
} ds4di_spec_event;

typedef struct {
    ds4di_spec_state state;
    bool ok;
    bool invalidate_profile;
} ds4di_spec_transition;

/* Structural transitions only: use controller_event to enforce sample gates.
 * FALLBACK latches until RESET, including across MODEL_SWITCH. A model switch
 * still invalidates the profile even when the state change is refused.
 */
ds4di_spec_transition ds4di_spec_state_transition(ds4di_spec_state state,
                                                  ds4di_spec_event event);
/* State eligibility only. Session code must use controller_applies below. */
bool ds4di_spec_applies(ds4di_spec_state state);

typedef struct {
    uint32_t candidate_length;
    uint32_t accepted_length;
    double step_ms;
    double draft_ms;
    double target_ms;
    bool valid; /* False also reports external faults (sampling, mismatch, etc.). */
} ds4di_spec_observation;

typedef struct {
    ds4di_spec_state state;
    bool profile_valid; /* Caller sets true only after loading a matching profile. */
    double acceptance_ema;
    uint64_t observations;
    uint64_t ratio_samples;
    uint64_t faults;
} ds4di_spec_controller;

void ds4di_spec_controller_init(ds4di_spec_controller *ctl);
/* Promotions need a valid profile and >=16 ratio samples. RESET/MODEL_SWITCH
 * clear the profile, EMA and counters. FAULT invalidates the profile.
 */
bool ds4di_spec_controller_event(ds4di_spec_controller *ctl,
                                 ds4di_spec_event event);
/* SHADOW computes decisions but never applies; CANARY requires explicit opt-in. */
bool ds4di_spec_controller_applies(const ds4di_spec_controller *ctl,
                                   bool session_opted_in);
/* Nonfinite/negative timings, valid==false, or accepted>candidate cause FAULT.
 * candidate==0 (accepted==0) is valid but contributes no ratio sample.
 * EMA seeds from the first ratio, then uses alpha 0.1. Counters saturate.
 */
int ds4di_spec_observe(ds4di_spec_controller *ctl,
                       const ds4di_spec_observation *observation);

#endif
