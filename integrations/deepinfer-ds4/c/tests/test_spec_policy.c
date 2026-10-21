/*
 * Derived from DeepInfer (https://github.com/deepseek-ai/DeepInfer) commit 9bd9cf2,
 * csrc/engine/mtp_varlen.hpp, Apache-2.0. Modified: ported to C11 for DS4-Studio.
 */
#include "ds4di_spec_policy.h"

#include <assert.h>
#include <float.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static void ds4di_test_expectation(void)
{
    const double p[] = {0.9, 0.5, 0.1};
    const double bad[] = {NAN, INFINITY, -INFINITY, -0.1, 1.1};
    double value = -1.0;
    assert(ds4di_expected_accepted(p, 3, 3, &value) == DS4DI_OK);
    assert(fabs(value - (0.9 + 0.45 + 0.045)) < 1e-12);
    assert(ds4di_expected_accepted(p, 3, 1, &value) == DS4DI_OK);
    assert(value == 0.9);
    assert(ds4di_expected_accepted(NULL, 0, 0, &value) == DS4DI_OK);
    assert(value == 0.0);
    assert(ds4di_expected_accepted(p, 3, 4, &value) == DS4DI_ERR_LENGTH);
    assert(value == 0.0);
    assert(ds4di_expected_accepted(NULL, 1, 1, &value) == DS4DI_ERR_ARGUMENT);
    assert(ds4di_expected_accepted(p, 3, 3, NULL) == DS4DI_ERR_ARGUMENT);
    for (size_t i = 0; i < sizeof bad / sizeof bad[0]; ++i) {
        const double q[] = {0.0, bad[i]};
        value = 123.0;
        assert(ds4di_expected_accepted(q, 2, 2, &value) == DS4DI_ERR_CONFIDENCE);
        assert(value == 0.0); /* Invalid confidence still fails after product=0. */
        assert(ds4di_expected_accepted(q, 2, 1, &value) == DS4DI_OK);
    }
    const double boundaries[] = {1.0, 1.0, 0.0};
    assert(ds4di_expected_accepted(boundaries, 3, 3, &value) == DS4DI_OK);
    assert(value == 2.0);
}

static void ds4di_test_choose(void)
{
    const double p[] = {0.7, 0.6};
    const double times[] = {10.0, 9.0, 11.0};
    const uint8_t valid[] = {1, 1, 1};
    ds4di_spec_decision d;
    assert(ds4di_choose_draft_length(p, 2, times, valid, 3, 1, &d) == DS4DI_OK);
    assert(d.draft_length == 1 && d.reason == DS4DI_REASON_SELECTED);
    assert(ds4di_choose_draft_length(p, 2, times, valid, 3, 99, &d) == DS4DI_OK);
    assert(d.draft_length == 2); /* 2.12/11 > 1.7/9 > 1/10. */
    assert(ds4di_choose_draft_length(p, 2, times, valid, 1, 2, &d) == DS4DI_OK);
    assert(d.draft_length == 0 && d.reason == DS4DI_REASON_SELECTED);
    const double ones[] = {1.0, 1.0};
    const double tie_times[] = {1.0, 2.0, 3.0};
    const uint8_t only_drafts[] = {0, 1, 1};
    assert(ds4di_choose_draft_length(ones, 2, tie_times, valid, 3, 2, &d) == 0);
    assert(d.draft_length == 0);
    assert(ds4di_choose_draft_length(ones, 2, tie_times, only_drafts, 3, 2, &d) == 0);
    assert(d.draft_length == 1); /* Equal utility also ties toward smaller m>0. */
    const double bad_times[] = {NAN, 0.0, -1.0, INFINITY, -INFINITY};
    for (size_t i = 0; i < sizeof bad_times / sizeof bad_times[0]; ++i) {
        assert(ds4di_choose_draft_length(NULL, 0, &bad_times[i], valid, 1, 0, &d) == 0);
        assert(d.draft_length == 0 && d.reason == DS4DI_REASON_NO_PROFILE);
    }
    const uint8_t invalid[] = {0, 0, 0};
    assert(ds4di_choose_draft_length(p, 2, times, invalid, 3, 2, &d) == 0);
    assert(d.reason == DS4DI_REASON_NO_PROFILE && d.draft_length == 0);
    assert(ds4di_choose_draft_length(p, 2, NULL, NULL, 0, 2, &d) == 0);
    assert(d.reason == DS4DI_REASON_NO_PROFILE);
    const double bad_p[] = {NAN, INFINITY, -INFINITY, -0.1, 1.1};
    for (size_t i = 0; i < sizeof bad_p / sizeof bad_p[0]; ++i) {
        assert(ds4di_choose_draft_length(&bad_p[i], 1, times, valid, 1, 1, &d) < 0);
        assert(d.draft_length == 0 && d.reason == DS4DI_REASON_BAD_CONFIDENCE);
        /* Out-of-range confidence is unused when max_supported is zero. */
        assert(ds4di_choose_draft_length(&bad_p[i], 1, times, valid, 1, 0, &d) == 0);
        assert(d.reason == DS4DI_REASON_SELECTED);
    }
    assert(ds4di_choose_draft_length(NULL, 1, times, valid, 3, 1, &d) < 0);
    assert(d.reason == DS4DI_REASON_BAD_ARGUMENT && d.draft_length == 0);
    assert(ds4di_choose_draft_length(p, 2, NULL, valid, 3, 2, &d) < 0);
    assert(ds4di_choose_draft_length(p, 2, times, NULL, 3, 2, &d) < 0);
    assert(ds4di_choose_draft_length(p, 2, times, valid, 3, 2, NULL) < 0);
    assert(ds4di_choose_draft_length(NULL, UINT32_MAX, times, valid, 1, 0, &d) == 0);
    const double extreme_times[] = {DBL_MIN, DBL_MIN, DBL_MAX};
    assert(ds4di_choose_draft_length(ones, 2, extreme_times, valid, 3, 2, &d) == 0);
    assert(d.draft_length == 1);
    assert(strcmp(ds4di_reason_name(DS4DI_REASON_SELECTED), "selected") == 0);
    assert(strcmp(ds4di_reason_name(DS4DI_REASON_NO_PROFILE), "no_profile") == 0);
    assert(strcmp(ds4di_reason_name(DS4DI_REASON_BAD_CONFIDENCE), "bad_confidence") == 0);
    assert(strcmp(ds4di_reason_name(DS4DI_REASON_BAD_ARGUMENT), "bad_argument") == 0);
    assert(strcmp(ds4di_reason_name((ds4di_reason)99), "unknown") == 0);
}

static void ds4di_test_varlen_golden(void)
{
    uint32_t out[2] = {0, 0};
    const ds4di_seq_rates empty_history[] = {{NULL, 0, 2, true}, {NULL, 0, 3, false}};
    assert(ds4di_varlen_schedule(NULL, 0, 0.0, 0.0, empty_history, 2, out) == 0);
    assert(out[0] == 3 && out[1] == 4); /* Empty curve: 1+n_drafts each. */

    const double single_rates[] = {0.8, 0.4};
    const ds4di_seq_rates single = {single_rates, 2, 2, true};
    const ds4di_curve_point single_curve[] = {{1, 1.0}, {2, 1.2}, {3, 3.0}};
    /* Throughputs: 1/1=1, 1.8/1.2=1.5, 2.2/3=0.7333. */
    assert(ds4di_varlen_schedule(single_curve, 3, 0.0, 0.0, &single, 1, out) == 0);
    assert(out[0] == 2);
    assert(ds4di_varlen_schedule(single_curve, 3, -10.0, 0.0, &single, 1, out) == 0);
    assert(out[0] == 2); /* Negative slope is clamped to zero. */
    const ds4di_curve_point ceiling_curve[] = {{2, 1.0}, {4, 4.0}};
    assert(ds4di_varlen_schedule(ceiling_curve, 2, 0.0, 0.0, &single, 1, out) == 0);
    assert(out[0] == 2); /* q=1,2 both cost graph 2; q=3 costs graph 4. */

    const double a[] = {0.9, 0.8};
    const double b[] = {0.6, 0.1};
    const ds4di_seq_rates seqs[] = {{a, 2, 2, true}, {b, 2, 2, true}};
    const ds4di_curve_point curve[] = {{2, 1.0}, {3, 1.1}, {4, 1.2}, {6, 3.0}};
    /* Rates .9,.8,.6,.1. Utilities at total_q=2..6:
     * 2, 2.9/1.1, 3.7/1.2, 4.3/3, 4.4/3. Best total_q=4.
     * Both selected drafts belong to seq 0: lengths [3,1].
     */
    assert(ds4di_varlen_schedule(curve, 4, 0.0, 0.0, seqs, 2, out) == 0);
    assert(out[0] == 3 && out[1] == 1);
    const double c[] = {0.9, 0.1};
    const double d[] = {0.8, 0.7};
    const ds4di_seq_rates mixed[] = {{c, 2, 2, true}, {d, 2, 2, true}};
    assert(ds4di_varlen_schedule(curve, 4, 0.0, 0.0, mixed, 2, out) == 0);
    assert(out[0] == 2 && out[1] == 2); /* Best q=4 selects .9 and .8. */

    const double half[] = {0.5};
    const ds4di_seq_rates ties[] = {{half, 1, 1, true}, {half, 1, 1, true}};
    const ds4di_curve_point tie_alloc[] = {{2, 2.0}, {3, 2.0}, {4, 20.0}};
    assert(ds4di_varlen_schedule(tie_alloc, 3, 0.0, 0.0, ties, 2, out) == 0);
    assert(out[0] == 2 && out[1] == 1); /* q=3; equal rates choose lower seq index. */
    const ds4di_curve_point tie_budget[] = {{2, 2.0}, {3, 2.5}, {4, 20.0}};
    assert(ds4di_varlen_schedule(tie_budget, 3, 0.0, 0.0, ties, 2, out) == 0);
    assert(out[0] == 1 && out[1] == 1); /* 2/2 == 2.5/2.5: smaller total_q. */

    const double exhaustion_rates[] = {0.9, 0.8, 0.7};
    const ds4di_seq_rates exhaustion = {exhaustion_rates, 3, 3, true};
    const ds4di_curve_point short_curve[] = {{1, 2.0}, {2, 2.0}};
    assert(ds4di_varlen_schedule(short_curve, 2, 0.0, 0.0, &exhaustion, 1, out) == 0);
    assert(out[0] == 2); /* q=1:.5, q=2:.95; q=3,4 have no graph. */

    const double high[] = {0.9};
    const ds4di_seq_rates slope_seq = {high, 1, 1, true};
    const ds4di_curve_point slope_curve[] = {{1, 1.0}, {2, 1.5}};
    assert(ds4di_varlen_schedule(slope_curve, 2, 0.0, 0.0, &slope_seq, 1, out) == 0);
    assert(out[0] == 2); /* 1 vs 1.9/1.5. */
    assert(ds4di_varlen_schedule(slope_curve, 2, 10.0, 0.0, &slope_seq, 1, out) == 0);
    assert(out[0] == 1); /* 1/11 > 1.9/21.5. */
    assert(ds4di_varlen_schedule(slope_curve, 2, 10.0, 2.0, &slope_seq, 1, out) == 0);
    assert(out[0] == 2); /* 1/13 < 1.9/23.5. */

    const ds4di_curve_point padded_curve = {3, 1.0};
    assert(ds4di_varlen_schedule(&padded_curve, 1, 0.0, 0.0, empty_history, 1, out) == 0);
    assert(out[0] == 3); /* Empty history + has_draft pads with 1. */
    ds4di_seq_rates no_info = {NULL, 0, 2, false};
    assert(ds4di_varlen_schedule(&padded_curve, 1, 0.0, 0.0, &no_info, 1, out) == 0);
    assert(out[0] == 1); /* Empty history without draft info pads with 0. */
}

static void ds4di_test_varlen_errors_and_bounds(void)
{
    uint32_t out[DS4DI_MAX_SEQS];
    ds4di_seq_rates seqs[DS4DI_MAX_SEQS];
    const ds4di_curve_point full = {DS4DI_MAX_SEQS * (1 + DS4DI_MAX_DRAFT), 10.0};
    for (uint32_t i = 0; i < DS4DI_MAX_SEQS; ++i) {
        seqs[i] = (ds4di_seq_rates){NULL, 0, DS4DI_MAX_DRAFT, true};
    }
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, DS4DI_MAX_SEQS, out) == 0);
    for (uint32_t i = 0; i < DS4DI_MAX_SEQS; ++i) {
        assert(out[i] == 1 + DS4DI_MAX_DRAFT);
    }
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, DS4DI_MAX_SEQS + 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, NULL, 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, 1, NULL) < 0);
    assert(ds4di_varlen_schedule(NULL, 0, 0.0, 0.0, NULL, 0, NULL) == 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, NULL, 0, NULL) == 0);
    seqs[0].n_drafts = DS4DI_MAX_DRAFT + 1;
    assert(ds4di_varlen_schedule(NULL, 0, 0.0, 0.0, seqs, 1, out) < 0 && out[0] == 1);
    seqs[0] = (ds4di_seq_rates){NULL, 0, 2, true};
    assert(ds4di_varlen_schedule(NULL, 1, 0.0, 0.0, seqs, 1, out) < 0 && out[0] == 1);
    const ds4di_curve_point invalid[] = {{0, 1.0}, {1, NAN}, {1, INFINITY}, {1, 0.0}, {1, -1.0}};
    for (size_t i = 0; i < sizeof invalid / sizeof invalid[0]; ++i) {
        assert(ds4di_varlen_schedule(&invalid[i], 1, 0.0, 0.0, seqs, 1, out) < 0);
        assert(out[0] == 1);
    }
    const ds4di_curve_point unsorted[] = {{3, 1.0}, {2, 2.0}};
    const ds4di_curve_point duplicate[] = {{3, 1.0}, {3, 2.0}};
    assert(ds4di_varlen_schedule(unsorted, 2, 0.0, 0.0, seqs, 1, out) < 0);
    assert(ds4di_varlen_schedule(duplicate, 2, 0.0, 0.0, seqs, 1, out) < 0);
    const ds4di_curve_point too_small = {1, 1.0};
    assert(ds4di_varlen_schedule(&too_small, 1, 0.0, 0.0, seqs, 2, out) < 0);
    assert(out[0] == 1 && out[1] == 1);
    assert(ds4di_varlen_schedule(&full, 1, NAN, 0.0, seqs, 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, INFINITY, 0.0, seqs, 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, NAN, seqs, 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, INFINITY, seqs, 1, out) < 0);
    assert(ds4di_varlen_schedule(&full, 1, 0.0, -1.0, seqs, 1, out) < 0);
    const double bad[] = {NAN, INFINITY, -INFINITY, -0.1, 1.1};
    seqs[0] = (ds4di_seq_rates){bad, 1, 1, true};
    for (size_t i = 0; i < sizeof bad / sizeof bad[0]; ++i) {
        seqs[0].rates = &bad[i];
        assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, 1, out) == DS4DI_ERR_CONFIDENCE);
        assert(out[0] == 1);
    }
    seqs[0].n_drafts = 2;
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, 1, out) == DS4DI_ERR_ARGUMENT);
    seqs[0] = (ds4di_seq_rates){NULL, 1, 1, true};
    assert(ds4di_varlen_schedule(&full, 1, 0.0, 0.0, seqs, 1, out) == DS4DI_ERR_ARGUMENT);
}

static void ds4di_test_median(void)
{
    ds4di_median_window window = {0};
    double value = 99.0;
    const double samples[] = {9, 1, 8, 2, 7, 6, 3, 5, 4, 10, 11};
    const double medians[] = {0, 0, 0, 0, 7, 6.5, 6, 5.5, 5, 5, 6};
    assert(!ds4di_median_window_get(&window, &value) && value == 0.0);
    for (size_t i = 0; i < sizeof samples / sizeof samples[0]; ++i) {
        assert(ds4di_median_window_update(&window, samples[i]));
        const bool available = ds4di_median_window_get(&window, &value);
        assert(available == (i + 1 >= DS4DI_MEDIAN_MIN_SAMPLES));
        assert(value == medians[i]);
    }
    const uint32_t old_next = window.next;
    assert(!ds4di_median_window_update(&window, NAN));
    assert(!ds4di_median_window_update(&window, INFINITY));
    assert(!ds4di_median_window_update(&window, -INFINITY));
    assert(window.rejected_samples == 3 && window.next == old_next);
    assert(window.size == 9 && ds4di_median_window_get(&window, &value) && value == 6);
    window.rejected_samples = UINT64_MAX;
    assert(!ds4di_median_window_update(&window, NAN));
    assert(window.rejected_samples == UINT64_MAX);
    ds4di_median_window_init(&window);
    assert(window.size == 0 && window.next == 0 && window.rejected_samples == 0);
    for (uint32_t i = 0; i < 6; ++i) {
        assert(ds4di_median_window_update(&window, DBL_MAX));
    }
    assert(ds4di_median_window_get(&window, &value) && value == DBL_MAX);
    ds4di_median_window other = {0};
    for (uint32_t i = 0; i < 5; ++i) {
        assert(ds4di_median_window_update(&other, -1.0));
    }
    assert(ds4di_median_window_get(&other, &value) && value == -1.0);
    assert(ds4di_median_window_get(&window, &value) && value == DBL_MAX);
    assert(!ds4di_median_window_get(NULL, &value) && value == 0.0);
    assert(!ds4di_median_window_get(&window, NULL));
    assert(!ds4di_median_window_update(NULL, 1.0));
    ds4di_median_window_init(NULL);
}

static void ds4di_test_transitions(void)
{
    /* Columns: shadow, canary, enabled, fault, reset, model switch. */
    const ds4di_spec_state states[5][6] = {
        {DS4DI_STATE_SHADOW, DS4DI_STATE_DISABLED, DS4DI_STATE_DISABLED,
         DS4DI_STATE_FALLBACK, DS4DI_STATE_DISABLED, DS4DI_STATE_DISABLED},
        {DS4DI_STATE_SHADOW, DS4DI_STATE_CANARY, DS4DI_STATE_SHADOW,
         DS4DI_STATE_FALLBACK, DS4DI_STATE_DISABLED, DS4DI_STATE_DISABLED},
        {DS4DI_STATE_CANARY, DS4DI_STATE_CANARY, DS4DI_STATE_ENABLED,
         DS4DI_STATE_FALLBACK, DS4DI_STATE_DISABLED, DS4DI_STATE_DISABLED},
        {DS4DI_STATE_ENABLED, DS4DI_STATE_ENABLED, DS4DI_STATE_ENABLED,
         DS4DI_STATE_FALLBACK, DS4DI_STATE_DISABLED, DS4DI_STATE_DISABLED},
        {DS4DI_STATE_FALLBACK, DS4DI_STATE_FALLBACK, DS4DI_STATE_FALLBACK,
         DS4DI_STATE_FALLBACK, DS4DI_STATE_DISABLED, DS4DI_STATE_FALLBACK}
    };
    const bool ok[5][6] = {
        {true, false, false, true, true, true},
        {false, true, false, true, true, true},
        {false, false, true, true, true, true},
        {false, false, false, true, true, true},
        {false, false, false, true, true, false}
    };
    for (uint32_t s = 0; s < 5; ++s) {
        assert(ds4di_spec_applies((ds4di_spec_state)s) == (s == 2 || s == 3));
        for (uint32_t e = 0; e < 6; ++e) {
            const ds4di_spec_transition t = ds4di_spec_state_transition(
                (ds4di_spec_state)s, (ds4di_spec_event)e);
            assert(t.state == states[s][e] && t.ok == ok[s][e]);
            assert(t.invalidate_profile == (e >= DS4DI_EVENT_FAULT));
            ds4di_spec_controller ctl = {(ds4di_spec_state)s, true, 0.5, 20, 16, 3};
            assert(ds4di_spec_controller_event(&ctl, (ds4di_spec_event)e) == ok[s][e]);
            assert(ctl.state == states[s][e]);
            assert(ctl.profile_valid == !t.invalidate_profile);
            if (e == DS4DI_EVENT_RESET || e == DS4DI_EVENT_MODEL_SWITCH) {
                assert(ctl.observations == 0 && ctl.ratio_samples == 0);
                assert(ctl.faults == 3u && ctl.acceptance_ema == 0.0);
            } else {
                assert(ctl.observations == 20 && ctl.ratio_samples == 16);
                assert(ctl.faults == (e == DS4DI_EVENT_FAULT ? 4u : 3u));
            }
        }
    }
    ds4di_spec_transition t = ds4di_spec_state_transition(DS4DI_STATE_SHADOW, (ds4di_spec_event)99);
    assert(!t.ok && t.state == DS4DI_STATE_SHADOW && !t.invalidate_profile);
    t = ds4di_spec_state_transition((ds4di_spec_state)99, DS4DI_EVENT_FAULT);
    assert(!t.ok && t.state == (ds4di_spec_state)99);
    assert(!ds4di_spec_applies((ds4di_spec_state)99));
}

static void ds4di_test_controller(void)
{
    ds4di_spec_controller ctl;
    ds4di_spec_controller_init(&ctl);
    assert(ctl.state == DS4DI_STATE_DISABLED && !ctl.profile_valid);
    assert(ds4di_spec_controller_event(&ctl, DS4DI_EVENT_ENABLE_SHADOW));
    ctl.profile_valid = true;
    ds4di_spec_observation o = {2, 1, 10.0, 2.0, 8.0, true};
    assert(ds4di_spec_observe(&ctl, &o) == 0 && ctl.acceptance_ema == 0.5);
    o.accepted_length = 2;
    assert(ds4di_spec_observe(&ctl, &o) == 0);
    assert(fabs(ctl.acceptance_ema - 0.55) < 1e-12);
    for (uint32_t i = 2; i < 15; ++i) {
        assert(ds4di_spec_observe(&ctl, &o) == 0);
    }
    assert(ctl.ratio_samples == 15);
    assert(!ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_CANARY));
    assert(!ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_ENABLED));
    assert(!ds4di_spec_controller_applies(&ctl, true));
    assert(ds4di_spec_observe(&ctl, &o) == 0 && ctl.ratio_samples == 16);
    ctl.profile_valid = false;
    assert(!ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_CANARY));
    ctl.profile_valid = true;
    assert(ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_CANARY));
    assert(!ds4di_spec_controller_applies(&ctl, false));
    assert(ds4di_spec_controller_applies(&ctl, true));
    ctl.ratio_samples = 15;
    assert(!ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_ENABLED));
    ctl.ratio_samples = 16;
    assert(ds4di_spec_controller_event(&ctl, DS4DI_EVENT_PROMOTE_ENABLED));
    assert(ds4di_spec_controller_applies(&ctl, false));
    assert(ds4di_spec_controller_event(&ctl, DS4DI_EVENT_MODEL_SWITCH));
    assert(ctl.state == DS4DI_STATE_DISABLED && !ctl.profile_valid && ctl.ratio_samples == 0);
    assert(!ds4di_spec_controller_applies(&ctl, true));

    const ds4di_spec_observation zero = {0, 0, 0.0, 0.0, 0.0, true};
    for (uint32_t i = 0; i < 16; ++i) {
        assert(ds4di_spec_observe(&ctl, &zero) == 0);
    }
    assert(ctl.observations == 16 && ctl.ratio_samples == 0 && ctl.acceptance_ema == 0.0);
    ctl.observations = UINT64_MAX;
    ctl.ratio_samples = UINT64_MAX;
    ctl.acceptance_ema = 1.0;
    assert(ds4di_spec_observe(&ctl, &o) == 0);
    assert(ctl.observations == UINT64_MAX && ctl.ratio_samples == UINT64_MAX);
    ctl.faults = UINT64_MAX;
    assert(ds4di_spec_observe(&ctl, NULL) == DS4DI_ERR_OBSERVATION);
    assert(ctl.state == DS4DI_STATE_FALLBACK && ctl.faults == UINT64_MAX);
    assert(!ds4di_spec_controller_applies(&ctl, true));
    assert(!ds4di_spec_controller_event(&ctl, DS4DI_EVENT_MODEL_SWITCH));
    assert(ctl.state == DS4DI_STATE_FALLBACK && !ctl.profile_valid);
    assert(ctl.faults == UINT64_MAX); /* fault history survives a model switch */
    assert(ds4di_spec_controller_event(&ctl, DS4DI_EVENT_RESET));
    assert(ctl.state == DS4DI_STATE_DISABLED && ctl.faults == UINT64_MAX);
    assert(ctl.ratio_samples == 0 && ctl.observations == 0);
    assert(ds4di_spec_observe(NULL, &o) == DS4DI_ERR_ARGUMENT);
    assert(!ds4di_spec_controller_event(NULL, DS4DI_EVENT_FAULT));
    assert(!ds4di_spec_controller_applies(NULL, true));
    ds4di_spec_controller_init(NULL);
}

static void ds4di_test_observation_faults(void)
{
    const double invalid[] = {NAN, INFINITY, -INFINITY, -0.1};
    for (uint32_t state = 0; state < 5; ++state) {
        for (uint32_t field = 0; field < 3; ++field) {
            for (size_t i = 0; i < sizeof invalid / sizeof invalid[0]; ++i) {
                ds4di_spec_controller ctl = {(ds4di_spec_state)state, true, 0.5, 0, 16, 0};
                ds4di_spec_observation o = {2, 1, 10.0, 2.0, 8.0, true};
                if (field == 0) o.step_ms = invalid[i];
                if (field == 1) o.draft_ms = invalid[i];
                if (field == 2) o.target_ms = invalid[i];
                assert(ds4di_spec_observe(&ctl, &o) == DS4DI_ERR_OBSERVATION);
                assert(ctl.state == DS4DI_STATE_FALLBACK && !ctl.profile_valid);
                assert(ctl.faults == 1 && ctl.observations == 1);
                assert(ctl.ratio_samples == 16 && ctl.acceptance_ema == 0.5);
            }
        }
        const ds4di_spec_observation invalid_counts[] = {
            {0, 1, 1.0, 0.0, 1.0, true},
            {2, 3, 1.0, 0.0, 1.0, true},
            {2, 1, 1.0, 0.0, 1.0, false}
        };
        for (size_t i = 0; i < sizeof invalid_counts / sizeof invalid_counts[0]; ++i) {
            ds4di_spec_controller ctl = {(ds4di_spec_state)state, true, 0.0, 0, 0, 0};
            assert(ds4di_spec_observe(&ctl, &invalid_counts[i]) == DS4DI_ERR_OBSERVATION);
            assert(ctl.state == DS4DI_STATE_FALLBACK && !ctl.profile_valid);
            assert(ctl.faults == 1 && ctl.ratio_samples == 0);
        }
    }
}

static uint32_t ds4di_test_random(uint32_t *seed)
{
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    return *seed;
}

static void ds4di_test_fuzz(void)
{
    uint32_t seed = UINT32_C(0x4d545031);
    for (uint32_t iteration = 0; iteration < 10000; ++iteration) {
        double p[32];
        double times[33];
        uint8_t valid[33];
        const uint32_t n = ds4di_test_random(&seed) % 33;
        const uint32_t max_supported = ds4di_test_random(&seed) % 41;
        const uint32_t n_times = ds4di_test_random(&seed) % 34;
        const uint32_t limit = n < max_supported ? n : max_supported;
        bool bad_confidence = false;
        for (uint32_t i = 0; i < n; ++i) {
            const uint32_t r = ds4di_test_random(&seed) % 32;
            p[i] = r == 0 ? NAN : r == 1 ? INFINITY : r == 2 ? -0.1 :
                   r == 3 ? 1.1 : (double)(ds4di_test_random(&seed) % 1001) / 1000.0;
            if (i < limit && (!isfinite(p[i]) || p[i] < 0.0 || p[i] > 1.0)) {
                bad_confidence = true;
            }
        }
        for (uint32_t i = 0; i < n_times; ++i) {
            const uint32_t r = ds4di_test_random(&seed) % 16;
            times[i] = r == 0 ? NAN : r == 1 ? INFINITY : r == 2 ? 0.0 :
                       r == 3 ? -1.0 : 0.1 + (double)(ds4di_test_random(&seed) % 1000);
            valid[i] = (uint8_t)(ds4di_test_random(&seed) % 2);
        }
        ds4di_spec_decision decision;
        const int status = ds4di_choose_draft_length(p, n, times, valid, n_times,
                                                     max_supported, &decision);
        assert(decision.draft_length <= max_supported && decision.draft_length <= n);
        if (bad_confidence) {
            assert(status == DS4DI_ERR_CONFIDENCE);
            assert(decision.draft_length == 0 && decision.reason == DS4DI_REASON_BAD_CONFIDENCE);
        } else {
            assert(status == DS4DI_OK);
            bool feasible = false;
            for (uint32_t m = 0; m <= limit; ++m) {
                if (m < n_times && valid[m] && isfinite(times[m]) && times[m] > 0.0) {
                    feasible = true;
                }
            }
            if (!feasible) {
                assert(decision.reason == DS4DI_REASON_NO_PROFILE && decision.draft_length == 0);
            } else {
                const uint32_t chosen = decision.draft_length;
                assert(decision.reason == DS4DI_REASON_SELECTED);
                assert(chosen < n_times && valid[chosen] && isfinite(times[chosen]) && times[chosen] > 0.0);
                double selected_expected;
                assert(ds4di_expected_accepted(p, n, chosen, &selected_expected) == 0);
                const long double score = (1.0L + selected_expected) / times[chosen];
                for (uint32_t m = 0; m <= limit; ++m) {
                    if (m < n_times && valid[m] && isfinite(times[m]) && times[m] > 0.0) {
                        double expected;
                        assert(ds4di_expected_accepted(p, n, m, &expected) == 0);
                        const long double other = (1.0L + expected) / times[m];
                        assert(score >= other);
                        assert(score != other || chosen <= m);
                    }
                }
            }
        }

        ds4di_seq_rates seqs[4];
        double rates[4][DS4DI_MAX_DRAFT];
        uint32_t out[4];
        const uint32_t n_seqs = ds4di_test_random(&seed) % 5;
        for (uint32_t i = 0; i < n_seqs; ++i) {
            const uint32_t nd = ds4di_test_random(&seed) % (DS4DI_MAX_DRAFT + 1);
            double cumulative = 1.0;
            for (uint32_t j = 0; j < nd; ++j) {
                cumulative *= (double)(ds4di_test_random(&seed) % 1001) / 1000.0;
                rates[i][j] = cumulative;
            }
            seqs[i] = (ds4di_seq_rates){rates[i], nd, nd, true};
        }
        const ds4di_curve_point curve[] = {{4, 1.0}, {8, 2.0}, {32, 4.0}, {68, 6.0}};
        const uint32_t n_curve = iteration % 2 == 0 ? 4 : 0;
        assert(ds4di_varlen_schedule(curve, n_curve, 0.01, 0.2, seqs, n_seqs, out) == 0);
        for (uint32_t i = 0; i < n_seqs; ++i) {
            assert(out[i] >= 1 && out[i] <= 1 + seqs[i].n_drafts);
            if (n_curve == 0) assert(out[i] == 1 + seqs[i].n_drafts);
        }
    }
}

int main(void)
{
    ds4di_test_expectation();
    ds4di_test_choose();
    ds4di_test_varlen_golden();
    ds4di_test_varlen_errors_and_bounds();
    ds4di_test_median();
    ds4di_test_transitions();
    ds4di_test_controller();
    ds4di_test_observation_faults();
    ds4di_test_fuzz();
    puts("PASS: spec policy; varlen goldens; median; 30 state/event pairs; controller faults; 10000 fixed-seed fuzz iterations");
    return 0;
}
