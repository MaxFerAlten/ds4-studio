/*
 * Derived from DeepInfer (https://github.com/deepseek-ai/DeepInfer) commit 9bd9cf2,
 * csrc/engine/mtp_varlen.hpp, Apache-2.0. Modified: ported to C11 for DS4-Studio.
 */
#include "ds4di_spec_policy.h"

#include <math.h>
#include <stddef.h>

static bool ds4di_valid_probability(double value)
{
    return isfinite(value) && value >= 0.0 && value <= 1.0;
}

static void ds4di_increment(uint64_t *counter)
{
    if (*counter != UINT64_MAX) {
        ++*counter;
    }
}

int ds4di_expected_accepted(const double *cond_p, uint32_t n, uint32_t m,
                            double *out)
{
    double product = 1.0;
    double total = 0.0;
    if (out == NULL) {
        return DS4DI_ERR_ARGUMENT;
    }
    *out = 0.0;
    if (m > n) {
        return DS4DI_ERR_LENGTH;
    }
    if (m != 0 && cond_p == NULL) {
        return DS4DI_ERR_ARGUMENT;
    }
    for (uint32_t i = 0; i < m; ++i) {
        if (!ds4di_valid_probability(cond_p[i])) {
            return DS4DI_ERR_CONFIDENCE;
        }
        product *= cond_p[i];
        total += product;
    }
    *out = total;
    return DS4DI_OK;
}

int ds4di_choose_draft_length(const double *cond_p, uint32_t n,
                              const double *times_ms, const uint8_t *times_valid,
                              uint32_t n_times, uint32_t max_supported,
                              ds4di_spec_decision *out)
{
    const uint32_t limit = n < max_supported ? n : max_supported;
    double product = 1.0;
    double expected = 0.0;
    long double best_score = -1.0L;
    if (out == NULL) {
        return DS4DI_ERR_ARGUMENT;
    }
    *out = (ds4di_spec_decision){0, DS4DI_REASON_BAD_ARGUMENT};
    if ((limit != 0 && cond_p == NULL) ||
        (n_times != 0 && (times_ms == NULL || times_valid == NULL))) {
        return DS4DI_ERR_ARGUMENT;
    }
    for (uint32_t i = 0; i < limit; ++i) {
        if (!ds4di_valid_probability(cond_p[i])) {
            out->reason = DS4DI_REASON_BAD_CONFIDENCE;
            return DS4DI_ERR_CONFIDENCE;
        }
    }
    out->reason = DS4DI_REASON_NO_PROFILE;
    /* Break before incrementing m so UINT32_MAX remains a valid limit. */
    for (uint32_t m = 0;; ++m) {
        if (m != 0) {
            product *= cond_p[m - 1];
            expected += product;
        }
        if (m < n_times && times_valid[m] != 0 &&
            isfinite(times_ms[m]) && times_ms[m] > 0.0) {
            const long double score = (1.0L + expected) / times_ms[m];
            if (score > best_score) {
                best_score = score;
                out->draft_length = m;
                out->reason = DS4DI_REASON_SELECTED;
            }
        }
        if (m == limit) {
            break;
        }
    }
    return DS4DI_OK;
}

const char *ds4di_reason_name(ds4di_reason reason)
{
    switch (reason) {
    case DS4DI_REASON_SELECTED: return "selected";
    case DS4DI_REASON_NO_PROFILE: return "no_profile";
    case DS4DI_REASON_BAD_CONFIDENCE: return "bad_confidence";
    case DS4DI_REASON_BAD_ARGUMENT: return "bad_argument";
    default: return "unknown";
    }
}

void ds4di_median_window_init(ds4di_median_window *window)
{
    if (window != NULL) {
        *window = (ds4di_median_window){0};
    }
}

bool ds4di_median_window_update(ds4di_median_window *window, double sample_ms)
{
    if (window == NULL) {
        return false;
    }
    if (!isfinite(sample_ms)) {
        ds4di_increment(&window->rejected_samples);
        return false;
    }
    window->samples[window->next] = sample_ms;
    window->next = (window->next + 1) % DS4DI_MEDIAN_WINDOW;
    if (window->size < DS4DI_MEDIAN_WINDOW) {
        ++window->size;
    }
    return true;
}

bool ds4di_median_window_get(const ds4di_median_window *window, double *out)
{
    double sorted[DS4DI_MEDIAN_WINDOW];
    if (out == NULL) {
        return false;
    }
    *out = 0.0;
    if (window == NULL || window->size < DS4DI_MEDIAN_MIN_SAMPLES) {
        return false;
    }
    for (uint32_t i = 0; i < window->size; ++i) {
        uint32_t j = i;
        sorted[i] = window->samples[i];
        while (j != 0 && sorted[j] < sorted[j - 1]) {
            const double swap = sorted[j];
            sorted[j] = sorted[j - 1];
            sorted[j - 1] = swap;
            --j;
        }
    }
    const uint32_t middle = window->size / 2;
    *out = window->size % 2 != 0 ? sorted[middle] :
           sorted[middle - 1] * 0.5 + sorted[middle] * 0.5;
    return true;
}

typedef struct {
    double rate;
    uint32_t seq_idx;
} ds4di_ranked_rate;

static bool ds4di_rank_before(ds4di_ranked_rate a, ds4di_ranked_rate b)
{
    return a.rate > b.rate || (a.rate == b.rate && a.seq_idx < b.seq_idx);
}

int ds4di_varlen_schedule(const ds4di_curve_point *curve, uint32_t n_curve,
                          double slope_ms, double sampler_ms,
                          const ds4di_seq_rates *seqs, uint32_t n_seqs,
                          uint32_t *seqlens_q_out)
{
    ds4di_ranked_rate ranked[DS4DI_MAX_SEQS * DS4DI_MAX_DRAFT];
    uint32_t n_ranked = 0;
    uint32_t graph_idx = 0;
    uint32_t best_extra = 0;
    long double expected = n_seqs;
    long double best_score = -1.0L;
    if (n_seqs > DS4DI_MAX_SEQS) {
        return DS4DI_ERR_LENGTH;
    }
    if (n_seqs != 0 && (seqs == NULL || seqlens_q_out == NULL)) {
        return DS4DI_ERR_ARGUMENT;
    }
    for (uint32_t i = 0; i < n_seqs; ++i) {
        seqlens_q_out[i] = 1;
    }
    for (uint32_t i = 0; i < n_seqs; ++i) {
        if (seqs[i].n_drafts > DS4DI_MAX_DRAFT) {
            return DS4DI_ERR_LENGTH;
        }
    }
    if (n_curve == 0) {
        for (uint32_t i = 0; i < n_seqs; ++i) {
            seqlens_q_out[i] += seqs[i].n_drafts;
        }
        return DS4DI_OK;
    }
    if (curve == NULL) {
        return DS4DI_ERR_ARGUMENT;
    }
    if (!isfinite(slope_ms) || !isfinite(sampler_ms) || sampler_ms < 0.0) {
        return DS4DI_ERR_PROFILE;
    }
    if (slope_ms < 0.0) {
        slope_ms = 0.0;
    }
    for (uint32_t i = 0; i < n_curve; ++i) {
        if (curve[i].graph_size == 0 ||
            (i != 0 && curve[i].graph_size <= curve[i - 1].graph_size) ||
            !isfinite(curve[i].baseline_ms) || curve[i].baseline_ms <= 0.0) {
            return DS4DI_ERR_PROFILE;
        }
    }
    for (uint32_t i = 0; i < n_seqs; ++i) {
        if (seqs[i].n_rates != 0 &&
            (seqs[i].n_rates != seqs[i].n_drafts || seqs[i].rates == NULL)) {
            return DS4DI_ERR_ARGUMENT;
        }
        for (uint32_t j = 0; j < seqs[i].n_drafts; ++j) {
            const double rate = seqs[i].n_rates != 0 ? seqs[i].rates[j] :
                                (seqs[i].has_draft ? 1.0 : 0.0);
            if (!ds4di_valid_probability(rate)) {
                return DS4DI_ERR_CONFIDENCE;
            }
            const ds4di_ranked_rate entry = {rate, i};
            uint32_t k = n_ranked;
            while (k != 0 && ds4di_rank_before(entry, ranked[k - 1])) {
                ranked[k] = ranked[k - 1];
                --k;
            }
            ranked[k] = entry;
            ++n_ranked;
        }
    }
    if (n_seqs == 0) {
        return DS4DI_OK;
    }
    for (uint32_t extra = 0; extra <= n_ranked; ++extra) {
        const uint32_t total_q = n_seqs + extra;
        if (extra != 0) {
            expected += ranked[extra - 1].rate;
        }
        while (graph_idx < n_curve && total_q > curve[graph_idx].graph_size) {
            ++graph_idx;
        }
        if (graph_idx == n_curve) {
            break;
        }
        const long double time_ms = curve[graph_idx].baseline_ms +
            (long double)slope_ms * curve[graph_idx].graph_size + sampler_ms;
        const long double score = expected / time_ms;
        if (score > best_score) {
            best_score = score;
            best_extra = extra;
        }
    }
    if (best_score < 0.0L) {
        return DS4DI_ERR_PROFILE;
    }
    for (uint32_t i = 0; i < best_extra; ++i) {
        ++seqlens_q_out[ranked[i].seq_idx];
    }
    return DS4DI_OK;
}

ds4di_spec_transition ds4di_spec_state_transition(ds4di_spec_state state,
                                                  ds4di_spec_event event)
{
    ds4di_spec_transition result = {state, false, false};
    if (state < DS4DI_STATE_DISABLED || state > DS4DI_STATE_FALLBACK) {
        return result;
    }
    if (event == DS4DI_EVENT_RESET) {
        return (ds4di_spec_transition){DS4DI_STATE_DISABLED, true, true};
    }
    if (event == DS4DI_EVENT_FAULT) {
        return (ds4di_spec_transition){DS4DI_STATE_FALLBACK, true, true};
    }
    if (event == DS4DI_EVENT_MODEL_SWITCH) {
        result.invalidate_profile = true;
        if (state != DS4DI_STATE_FALLBACK) {
            result.state = DS4DI_STATE_DISABLED;
            result.ok = true;
        }
        return result;
    }
    if (state == DS4DI_STATE_DISABLED && event == DS4DI_EVENT_ENABLE_SHADOW) {
        return (ds4di_spec_transition){DS4DI_STATE_SHADOW, true, false};
    }
    if (state == DS4DI_STATE_SHADOW && event == DS4DI_EVENT_PROMOTE_CANARY) {
        return (ds4di_spec_transition){DS4DI_STATE_CANARY, true, false};
    }
    if (state == DS4DI_STATE_CANARY && event == DS4DI_EVENT_PROMOTE_ENABLED) {
        return (ds4di_spec_transition){DS4DI_STATE_ENABLED, true, false};
    }
    return result;
}

bool ds4di_spec_applies(ds4di_spec_state state)
{
    return state == DS4DI_STATE_CANARY || state == DS4DI_STATE_ENABLED;
}

void ds4di_spec_controller_init(ds4di_spec_controller *ctl)
{
    if (ctl != NULL) {
        *ctl = (ds4di_spec_controller){0};
    }
}

bool ds4di_spec_controller_event(ds4di_spec_controller *ctl,
                                 ds4di_spec_event event)
{
    if (ctl == NULL) {
        return false;
    }
    const ds4di_spec_transition transition =
        ds4di_spec_state_transition(ctl->state, event);
    if (event == DS4DI_EVENT_RESET || event == DS4DI_EVENT_MODEL_SWITCH) {
        if (transition.invalidate_profile) {
            /* Statistics belong to the old model; the fault history does not. */
            const uint64_t faults = ctl->faults;
            ds4di_spec_controller_init(ctl);
            ctl->state = transition.state;
            ctl->faults = faults;
        }
        return transition.ok;
    }
    if (!transition.ok) {
        return false;
    }
    if ((event == DS4DI_EVENT_PROMOTE_CANARY ||
         event == DS4DI_EVENT_PROMOTE_ENABLED) &&
        (!ctl->profile_valid || ctl->ratio_samples < DS4DI_PROMOTION_MIN_SAMPLES)) {
        return false;
    }
    ctl->state = transition.state;
    if (transition.invalidate_profile) {
        ctl->profile_valid = false;
    }
    if (event == DS4DI_EVENT_FAULT) {
        ds4di_increment(&ctl->faults);
    }
    return true;
}

bool ds4di_spec_controller_applies(const ds4di_spec_controller *ctl,
                                   bool session_opted_in)
{
    return ctl != NULL && ctl->profile_valid && ds4di_spec_applies(ctl->state) &&
           (ctl->state != DS4DI_STATE_CANARY || session_opted_in);
}

int ds4di_spec_observe(ds4di_spec_controller *ctl,
                       const ds4di_spec_observation *observation)
{
    if (ctl == NULL) {
        return DS4DI_ERR_ARGUMENT;
    }
    ds4di_increment(&ctl->observations);
    if (observation == NULL || !observation->valid ||
        observation->accepted_length > observation->candidate_length ||
        !isfinite(observation->step_ms) || observation->step_ms < 0.0 ||
        !isfinite(observation->draft_ms) || observation->draft_ms < 0.0 ||
        !isfinite(observation->target_ms) || observation->target_ms < 0.0) {
        (void)ds4di_spec_controller_event(ctl, DS4DI_EVENT_FAULT);
        return DS4DI_ERR_OBSERVATION;
    }
    if (observation->candidate_length != 0) {
        const double ratio = (double)observation->accepted_length /
                             observation->candidate_length;
        ctl->acceptance_ema = ctl->ratio_samples == 0 ? ratio :
            ctl->acceptance_ema + DS4DI_ACCEPTANCE_EMA_ALPHA *
                                  (ratio - ctl->acceptance_ema);
        ds4di_increment(&ctl->ratio_samples);
    }
    return DS4DI_OK;
}
