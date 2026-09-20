#include "ds4_agent_epistemic.h"

#include <ctype.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const ds4_epistemic_failure_definition
    epi_failure_taxonomy[DS4_EPI_FAILURE_COUNT] = {
        [DS4_EPI_FAILURE_F01] = { "F01", "FABRICATED_SOURCE" },
        [DS4_EPI_FAILURE_F02] = { "F02", "SOURCE_DOES_NOT_SUPPORT_CLAIM" },
        [DS4_EPI_FAILURE_F03] = { "F03", "FABRICATED_EXPERIMENT" },
        [DS4_EPI_FAILURE_F04] = { "F04", "UNEXECUTED_CODE_PRESENTED_AS_EXECUTED" },
        [DS4_EPI_FAILURE_F05] = { "F05", "ARITHMETIC_ERROR" },
        [DS4_EPI_FAILURE_F06] = { "F06", "SYMBOLIC_DERIVATION_ERROR" },
        [DS4_EPI_FAILURE_F07] = { "F07", "DIMENSION_TYPE_ERROR" },
        [DS4_EPI_FAILURE_F08] = { "F08", "ANALOGY_PROMOTED_TO_FACT" },
        [DS4_EPI_FAILURE_F09] = { "F09", "HYPOTHESIS_PROMOTED_TO_OBSERVATION" },
        [DS4_EPI_FAILURE_F10] = { "F10", "INTERNAL_CONTRADICTION" },
        [DS4_EPI_FAILURE_F11] = { "F11", "UNKNOWN_PRESENTED_AS_KNOWN" },
        [DS4_EPI_FAILURE_F12] = { "F12", "ESTIMATE_PRESENTED_AS_OFFICIAL" },
        [DS4_EPI_FAILURE_F13] = { "F13", "SECONDARY_SOURCE_AS_PRIMARY" },
        [DS4_EPI_FAILURE_F14] = { "F14", "UNSUPPORTED_CAUSALITY" },
        [DS4_EPI_FAILURE_F15] = { "F15", "OVERGENERALIZATION" },
        [DS4_EPI_FAILURE_F16] = { "F16", "RECURSIVE_REPAIR_HALLUCINATION" },
        [DS4_EPI_FAILURE_F17] = { "F17", "CITATION_IDENTITY_MISMATCH" },
        [DS4_EPI_FAILURE_F18] = { "F18", "FALSE_VERIFICATION_CLAIM" },
        [DS4_EPI_FAILURE_F19] = { "F19", "EXPECTED_OUTPUT_PRESENTED_AS_OBSERVED" },
        [DS4_EPI_FAILURE_F20] = { "F20", "SOURCE_METADATA_RECOMBINATION" },
        [DS4_EPI_FAILURE_F21] = { "F21", "DOMAIN_INVARIANT_VIOLATION" },
        [DS4_EPI_FAILURE_F22] = { "F22", "TOOL_RESULT_MISREPRESENTATION" },
        [DS4_EPI_FAILURE_F23] = { "F23", "EPISTEMIC_PROMOTION_VIOLATION" },
        [DS4_EPI_FAILURE_F24] = { "F24", "DEPENDENT_CLAIM_NOT_INVALIDATED" },
        [DS4_EPI_FAILURE_F25] = { "F25", "CRITIQUE_ECHO_WITHOUT_VERIFICATION" },
        [DS4_EPI_FAILURE_F26] = { "F26", "REPAIR_SUMMARY_REINTRODUCES_UNVERIFIED_CLAIMS" }
    };

const ds4_epistemic_failure_definition *ds4_agent_epistemic_failure_by_id(
    ds4_epistemic_failure_id id)
{
    if (id < 0 || id >= DS4_EPI_FAILURE_COUNT) {
        return NULL;
    }
    return &epi_failure_taxonomy[id];
}

/* R07-PATCH-01: "F27".."F40" are the JS-extended codes with no native enum
 * slot.  Transported verbatim, never given native semantics. */
static bool code_is_js_extended(const char *code)
{
    if (code == NULL || strlen(code) != 3 || code[0] != 'F') {
        return false;
    }
    const int n = (code[1] - '0') * 10 + (code[2] - '0');
    return n >= 27 && n <= 40;
}

const ds4_epistemic_failure_definition *ds4_agent_epistemic_failure_by_code(
    const char *code)
{
    if (code == NULL) {
        return NULL;
    }
    for (int i = 0; i < DS4_EPI_FAILURE_COUNT; i++) {
        if (strcmp(epi_failure_taxonomy[i].code, code) == 0) {
            return &epi_failure_taxonomy[i];
        }
    }

    /* R07-PATCH-01 — failure-code transport.
     *
     * The native taxonomy is intentionally bounded at F26 (no F27..F40
     * semantics live in C).  But a verdict produced by the JS pipeline can
     * carry those codes, and transport must represent them without a hard enum
     * limit.  We keep the code text and label it explicitly as transported —
     * the native side does NOT claim semantic parity for it.
     */
    static ds4_epistemic_failure_definition transported = {
        .code = "",
        .name = "JS_TRANSPORTED_UNSUPPORTED_SEMANTICS"
    };
    if (code_is_js_extended(code)) {
        transported.code = code;
        return &transported;
    }
    return NULL;
}

static bool name_is(const char *tool_name, const char *expected)
{
    return tool_name != NULL && strcmp(tool_name, expected) == 0;
}

/* A result that reported an outcome, and that outcome was success.  A missing
 * status is never success: the plan (section 43) forbids inferring one from
 * prose when no executor reported it. */
static bool result_succeeded(const ds4_agent_epistemic_tool_result *result)
{
    if (result == NULL || !result->has_status) {
        return false;
    }
    if (result->has_exit_code && result->exit_code != 0) {
        return false;
    }
    return result->ok;
}

static int epi_max_repair_rounds_from_env(void)
{
    const char *value = getenv("DS4_EPISTEMIC_MAX_REPAIR_ROUNDS");
    if (value == NULL || value[0] == '\0') {
        return DS4_EPI_DEFAULT_MAX_REPAIR_ROUNDS;
    }
    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (end == value || *end != '\0' || parsed < 0 ||
        parsed > DS4_EPI_MAX_REPAIR_ROUNDS) {
        return DS4_EPI_DEFAULT_MAX_REPAIR_ROUNDS;
    }
    return (int)parsed;
}

#define EPI_COMMAND_MAX_WORDS 32
#define EPI_COMMAND_WORD_LEN 64

static const char *epi_command_basename(const char *word)
{
    const char *slash = strrchr(word, '/');
    return slash == NULL ? word : slash + 1;
}

static bool epi_word_is(const char *word, const char *expected)
{
    return word != NULL && expected != NULL && strcmp(word, expected) == 0;
}

static bool epi_word_starts(const char *word, const char *prefix)
{
    return word != NULL && prefix != NULL &&
           strncmp(word, prefix, strlen(prefix)) == 0;
}

typedef struct {
    bool test;
    bool benchmark;
} epi_command_classification;

static void epi_classify_command_words(char words[][EPI_COMMAND_WORD_LEN], int count,
                                       epi_command_classification *out)
{
    if (count <= 0) {
        return;
    }
    int executable = 0;
    if (epi_word_is(epi_command_basename(words[executable]), "rtk")) {
        executable++;
    }
    if (executable >= count) {
        return;
    }

    const char *name = epi_command_basename(words[executable]);
    const int arg = executable + 1;
    if (epi_word_is(name, "pytest") || epi_word_is(name, "pytest-3") ||
        epi_word_is(name, "ctest")) {
        out->test = true;
    } else if (epi_word_is(name, "node") && arg < count &&
               (epi_word_is(words[arg], "--test") ||
                epi_word_starts(words[arg], "--test="))) {
        out->test = true;
    } else if (epi_word_is(name, "npm") && arg < count) {
        if (epi_word_is(words[arg], "test")) {
            out->test = true;
        } else if (epi_word_is(words[arg], "run") && arg + 1 < count) {
            if (epi_word_is(words[arg + 1], "test") ||
                epi_word_starts(words[arg + 1], "test:")) {
                out->test = true;
            }
            if (epi_word_is(words[arg + 1], "benchmark") ||
                epi_word_is(words[arg + 1], "bench")) {
                out->benchmark = true;
            }
        }
    } else if (epi_word_is(name, "make") && arg < count) {
        for (int i = arg; i < count; i++) {
            if (epi_word_is(words[i], "test")) out->test = true;
            if (epi_word_is(words[i], "benchmark") || epi_word_is(words[i], "bench")) {
                out->benchmark = true;
            }
        }
    } else if (epi_word_is(name, "cargo") && arg < count) {
        out->test = epi_word_is(words[arg], "test");
        out->benchmark = epi_word_is(words[arg], "bench");
    } else if (epi_word_is(name, "go") && arg < count &&
               epi_word_is(words[arg], "test")) {
        out->test = true;
        for (int i = arg + 1; i < count; i++) {
            if (epi_word_starts(words[i], "-bench")) out->benchmark = true;
        }
    } else if (epi_word_is(name, "hyperfine")) {
        out->benchmark = true;
    }
}

static epi_command_classification epi_classify_command(const char *command)
{
    epi_command_classification out = {0};
    char words[EPI_COMMAND_MAX_WORDS][EPI_COMMAND_WORD_LEN];
    int count = 0;
    const char *p = command;

    while (p != NULL && *p != '\0') {
        while (*p != '\0' && isspace((unsigned char)*p)) p++;
        if (*p == '\0') break;
        if (*p == ';' || *p == '|' || *p == '&') {
            epi_classify_command_words(words, count, &out);
            count = 0;
            while (*p == ';' || *p == '|' || *p == '&') p++;
            continue;
        }

        char quote = 0;
        if (*p == '\'' || *p == '"') quote = *p++;
        size_t len = 0;
        while (*p != '\0' &&
               ((quote != 0 && *p != quote) ||
                (quote == 0 && !isspace((unsigned char)*p) &&
                 *p != ';' && *p != '|' && *p != '&'))) {
            if (len + 1 < EPI_COMMAND_WORD_LEN) words[count][len++] = *p;
            p++;
        }
        if (quote != 0 && *p == quote) p++;
        words[count][len] = '\0';
        if (len > 0 && ++count == EPI_COMMAND_MAX_WORDS) {
            epi_classify_command_words(words, count, &out);
            count = 0;
        }
    }
    epi_classify_command_words(words, count, &out);
    return out;
}

void ds4_agent_epistemic_turn_reset(ds4_agent_epistemic_turn *turn)
{
    if (turn == NULL) {
        return;
    }
    memset(turn, 0, sizeof(*turn));
    turn->max_repair_rounds = epi_max_repair_rounds_from_env();
}

void ds4_agent_epistemic_note_tool(ds4_agent_epistemic_turn *turn,
                                   const char *tool_name,
                                   const ds4_agent_epistemic_tool_result *result)
{
    if (turn == NULL) {
        return;
    }

    /* A tool ran.  Whether it worked is a separate question, answered below and
     * only from the structured status. */
    turn->used_real_tool = true;

    const bool succeeded = result_succeeded(result);

    if (name_is(tool_name, "bash")) {
        turn->used_bash = true;
        if (succeeded) {
            turn->observed_successful_bash = true;
        }
        return;
    }
    if (name_is(tool_name, "sage")) {
        /* Only a Sage run that reported success counts as validation.  A failed
         * or unreported one is a run, not a result. */
        if (succeeded) {
            turn->used_sage_validation = true;
        }
        return;
    }
    if (name_is(tool_name, "web_search") || name_is(tool_name, "google_search") ||
        name_is(tool_name, "search") || name_is(tool_name, "visit_page")) {
        if (succeeded) {
            turn->observed_web_source = true;
        }
        return;
    }
    if (name_is(tool_name, "crawl")) {
        if (succeeded) {
            turn->observed_crawl_source = true;
        }
        return;
    }
    if (name_is(tool_name, "research")) {
        if (succeeded) {
            turn->observed_research_source = true;
        }
    }
}

void ds4_agent_epistemic_note_command(ds4_agent_epistemic_turn *turn,
                                      const char *command,
                                      const ds4_agent_epistemic_tool_result *result)
{
    if (turn == NULL || command == NULL || command[0] == '\0') {
        return;
    }
    const epi_command_classification classified = epi_classify_command(command);
    const bool succeeded = result_succeeded(result);
    if (classified.test) {
        turn->observed_test_command = true;
        if (succeeded) turn->observed_successful_test_command = true;
    }
    if (classified.benchmark) {
        turn->observed_benchmark_command = true;
        if (succeeded) turn->observed_successful_benchmark_command = true;
    }
}

void ds4_agent_epistemic_note_failure(ds4_agent_epistemic_turn *turn, const char *code)
{
    if (turn == NULL) {
        return;
    }
    if (code == NULL) {
        turn->last_failure_code[0] = '\0';
        return;
    }
    size_t len = strlen(code);
    if (len >= sizeof(turn->last_failure_code)) {
        len = sizeof(turn->last_failure_code) - 1;
    }
    memcpy(turn->last_failure_code, code, len);
    turn->last_failure_code[len] = '\0';
}

bool ds4_agent_epistemic_has_execution_evidence(const ds4_agent_epistemic_turn *turn)
{
    return turn != NULL &&
           (turn->observed_successful_test_command ||
            turn->observed_successful_benchmark_command);
}

bool ds4_agent_epistemic_has_source_evidence(const ds4_agent_epistemic_turn *turn)
{
    if (turn == NULL) {
        return false;
    }
    return turn->observed_web_source || turn->observed_crawl_source ||
           turn->observed_research_source;
}

bool ds4_agent_epistemic_has_computation_evidence(const ds4_agent_epistemic_turn *turn)
{
    return turn != NULL && turn->used_sage_validation;
}

bool ds4_agent_epistemic_can_repair(const ds4_agent_epistemic_turn *turn)
{
    if (turn == NULL) {
        return false;
    }
    return turn->repair_rounds < turn->max_repair_rounds;
}

void ds4_agent_epistemic_begin_repair(ds4_agent_epistemic_turn *turn)
{
    if (turn == NULL) {
        return;
    }
    turn->repair_rounds++;
}

bool ds4_agent_epistemic_should_defer(const ds4_agent_epistemic_turn *turn,
                                      ds4_epistemic_mode mode)
{
    /* The turn is not consulted yet: in block mode every candidate is withheld
     * until the scan has run, because whether it needed withholding is exactly
     * what the scan decides. */
    (void)turn;
    return mode == DS4_EPI_MODE_BLOCK;
}

ds4_epistemic_mode ds4_agent_epistemic_mode_from_env(void)
{
    return ds4_agent_epistemic_mode_from_string(getenv("DS4_EPISTEMIC_MODE"));
}

ds4_epistemic_mode ds4_agent_epistemic_mode_from_string(const char *value)
{
    if (value == NULL) {
        return DS4_EPI_MODE_OFF;
    }
    if (strcmp(value, "shadow") == 0) {
        return DS4_EPI_MODE_SHADOW;
    }
    if (strcmp(value, "block") == 0) {
        return DS4_EPI_MODE_BLOCK;
    }
    /* "off", "", a typo, or anything else.  An unreadable setting must not
     * silently enable a gate, and must not silently disable one that was
     * spelled correctly either — only these two names turn it on. */
    return DS4_EPI_MODE_OFF;
}

const char *ds4_agent_epistemic_mode_name(ds4_epistemic_mode mode)
{
    switch (mode) {
    case DS4_EPI_MODE_SHADOW:
        return "shadow";
    case DS4_EPI_MODE_BLOCK:
        return "block";
    case DS4_EPI_MODE_OFF:
    default:
        return "off";
    }
}

/* ---- QF-24 section 46: high-severity lexical/structural gate ------------ */

static char epi_lower(char c)
{
    return (char)tolower((unsigned char)c);
}

static bool epi_is_word_char(char c)
{
    return isalnum((unsigned char)c) || c == '_';
}

/* Case-insensitive, length-bounded search, with a word boundary required at
 * whichever end of the needle is itself a word character.  Without it
 * "tested" fires inside "untested", which asserts the opposite. */
static bool epi_find_phrase(const char *text, size_t len, const char *needle)
{
    const size_t n = strlen(needle);
    if (text == NULL || n == 0 || len < n) {
        return false;
    }

    const bool head_word = epi_is_word_char(needle[0]);
    const bool tail_word = epi_is_word_char(needle[n - 1]);

    for (size_t i = 0; i + n <= len; i++) {
        size_t j = 0;
        while (j < n && epi_lower(text[i + j]) == epi_lower(needle[j])) {
            j++;
        }
        if (j != n) {
            continue;
        }
        if (head_word && i > 0 && epi_is_word_char(text[i - 1])) {
            continue;
        }
        if (tail_word && i + n < len && epi_is_word_char(text[i + n])) {
            continue;
        }
        return true;
    }
    return false;
}

/* Returns the literal that matched, never a pointer into the caller's buffer,
 * so a finding outlives the text it was found in. */
static const char *epi_find_any(const char *text, size_t len, const char *const *phrases)
{
    for (size_t i = 0; phrases[i] != NULL; i++) {
        if (epi_find_phrase(text, len, phrases[i])) {
            return phrases[i];
        }
    }
    return NULL;
}

static size_t epi_skip_spaces(const char *text, size_t len, size_t pos)
{
    while (pos < len && (text[pos] == ' ' || text[pos] == '\t')) {
        pos++;
    }
    return pos;
}

static bool epi_match_at(const char *text, size_t len, size_t pos, const char *lit)
{
    const size_t n = strlen(lit);
    if (pos + n > len) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        if (epi_lower(text[pos + i]) != epi_lower(lit[i])) {
            return false;
        }
    }
    return pos == 0 || !epi_is_word_char(text[pos - 1]);
}

static size_t epi_count_digits(const char *text, size_t len, size_t pos)
{
    size_t n = 0;
    while (pos + n < len && isdigit((unsigned char)text[pos + n])) {
        n++;
    }
    return n;
}

/* arXiv and DOI identifiers are structure rather than wording, so they get a
 * scanner instead of a phrase list.  A recombined identifier is the F17/F20
 * risk the plan names: the shape is right and nothing looked it up. */
static const char *epi_find_citation_identifier(const char *text, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        if (epi_match_at(text, len, i, "doi")) {
            size_t p = epi_skip_spaces(text, len, i + 3);
            if (p < len && text[p] == ':') {
                p = epi_skip_spaces(text, len, p + 1);
                if (p + 3 <= len && text[p] == '1' && text[p + 1] == '0' && text[p + 2] == '.') {
                    return "doi:10.";
                }
            }
        }
        if (epi_match_at(text, len, i, "arxiv")) {
            size_t p = epi_skip_spaces(text, len, i + 5);
            if (p < len && text[p] == ':') {
                p = epi_skip_spaces(text, len, p + 1);
                if (epi_count_digits(text, len, p) == 4 && p + 4 < len && text[p + 4] == '.') {
                    const size_t tail = epi_count_digits(text, len, p + 5);
                    if (tail == 4 || tail == 5) {
                        return "arXiv:NNNN.NNNNN";
                    }
                }
            }
        }
    }
    return NULL;
}

/* Native P0 keeps no observation trace of its own: a measurement in this
 * system happens through a command that ran or a Sage validation. */
static bool epi_has_observation_evidence(const ds4_agent_epistemic_turn *turn)
{
    return ds4_agent_epistemic_has_execution_evidence(turn) ||
           ds4_agent_epistemic_has_computation_evidence(turn);
}

/* Deliberately narrower than the JS lexical bridge: bare "measured" and bare
 * "observed" are left out, because the first native rollout blocks output and
 * a false positive there costs a real answer.  The phrases below are the ones
 * section 46 lists, plus their Italian forms - a guard that only reads English
 * is a guard with a documented bypass. */
static const char *const epi_f03_phrases[] = {
    "we measured", "i measured", "we benchmarked",
    "experiment confirmed", "the experiment confirmed", "experiment shows",
    "abbiamo misurato", "ho misurato",
    "l'esperimento conferma", "l'esperimento ha confermato", "l'esperimento mostra",
    NULL
};

static const char *const epi_f18_phrases[] = {
    "confirmed by internal analysis", "confirmed by our analysis",
    "internal analysis confirms", "our analysis confirms",
    "confermato dall'analisi interna", "confermato dalla nostra analisi",
    "l'analisi interna conferma", "la nostra analisi conferma",
    NULL
};

static const char *const epi_f04_phrases[] = {
    "working code", "passes tests", "passed the tests", "ran successfully",
    "tested", "benchmark shows",
    "codice funzionante", "i test passano", "eseguito con successo",
    "testato", "testata", "il benchmark mostra",
    NULL
};

static const char *const epi_f12_phrases[] = {
    "official", "officially", "exact architecture", "verified value",
    "ufficiale", "ufficialmente", "architettura esatta", "valore verificato",
    NULL
};

/* R07-PATCH-03 — native phrase hardening (verification wording).
 *
 * These promise a formal verification outcome.  Native P0 does NOT decide the
 * QHO semantics in C; it only fires when the phrasing asserts a verification
 * result the turn produced no structured evidence for.  If the turn ran a
 * computation/observation, the class is satisfied and nothing fires.
 */
static const char *const epi_f18_formal_phrases[] = {
    "formally proved", "formally proven",
    "all formulas verified", "all checks passed",
    "formalmente dimostrato", "tutte le formule verificate", "tutti i controlli superati",
    NULL
};

/* Section 90's anti-critique-echo invariant.  Native P0 is not told whether
 * the user challenged anything, so the trigger is text-local: a concession
 * plus a replacement claim this turn cannot support.  Conceding alone is not
 * a failure - conceding and then asserting a new unsupported answer is. */
static const char *const epi_f25_phrases[] = {
    "you are right", "you're right", "you were right",
    "hai ragione", "ha ragione", "avevi ragione", "hai perfettamente ragione",
    NULL
};

typedef struct {
    ds4_epistemic_failure_id failure_id;
    const char *requirement;
    const char *const *phrases;
    bool (*satisfied)(const ds4_agent_epistemic_turn *turn);
} epi_class;

static const epi_class epi_classes[] = {
    { DS4_EPI_FAILURE_F03, "an observation or computation trace",
      epi_f03_phrases, epi_has_observation_evidence },
    { DS4_EPI_FAILURE_F18, "an actual analysis trace",
      epi_f18_phrases, epi_has_observation_evidence },
    { DS4_EPI_FAILURE_F18, "a computation or observation trace",
      epi_f18_formal_phrases, epi_has_observation_evidence },
    { DS4_EPI_FAILURE_F04, "an execution trace",
      epi_f04_phrases, ds4_agent_epistemic_has_execution_evidence },
    { DS4_EPI_FAILURE_F12, "a primary source",
      epi_f12_phrases, ds4_agent_epistemic_has_source_evidence }
};

static void epi_record(ds4_epistemic_scan_result *out,
                       ds4_epistemic_failure_id failure_id,
                       const char *requirement, const char *match)
{
    const ds4_epistemic_failure_definition *failure =
        ds4_agent_epistemic_failure_by_id(failure_id);
    if (failure == NULL) {
        return;
    }
    out->detected_count++;
    if (out->finding_count >= DS4_EPI_MAX_FINDINGS) {
        return;
    }
    ds4_epistemic_finding *f = &out->findings[out->finding_count++];
    f->code = failure->code;
    f->name = failure->name;
    f->requirement = requirement;
    f->match = match;
}

ds4_epistemic_scan_result ds4_agent_epistemic_scan_final_text(
    const ds4_agent_epistemic_turn *turn, const char *text, size_t len)
{
    ds4_epistemic_scan_result out;
    memset(&out, 0, sizeof(out));
    out.verdict = DS4_EPI_VERDICT_ALLOW;

    if (text == NULL || len == 0) {
        return out;
    }

    for (size_t i = 0; i < sizeof(epi_classes) / sizeof(epi_classes[0]); i++) {
        const epi_class *c = &epi_classes[i];
        if (c->satisfied(turn)) {
            continue;
        }
        const char *match = epi_find_any(text, len, c->phrases);
        if (match != NULL) {
            epi_record(&out, c->failure_id, c->requirement, match);
        }
    }

    if (!ds4_agent_epistemic_has_source_evidence(turn)) {
        const char *identifier = epi_find_citation_identifier(text, len);
        if (identifier != NULL) {
            epi_record(&out, DS4_EPI_FAILURE_F17,
                       "a source this turn actually retrieved", identifier);
        }
    }

    /* After the others, because the replacement claim is what makes a
     * concession a failure. */
    if (out.detected_count > 0) {
        const char *concession = epi_find_any(text, len, epi_f25_phrases);
        if (concession != NULL) {
            epi_record(&out, DS4_EPI_FAILURE_F25,
                       "evidence for the replacement claim, not agreement", concession);
        }
    }

    if (out.detected_count > 0) {
        out.blocked = true;
        /* Not "false": section 46 forbids a C scan from claiming a semantic
         * verdict it has no way to reach. */
        out.verdict = DS4_EPI_VERDICT_BLOCK_UNSUPPORTED;
    }
    return out;
}

bool ds4_agent_epistemic_can_publish(const ds4_epistemic_scan_result *scan,
                                     ds4_epistemic_mode mode)
{
    if (mode != DS4_EPI_MODE_BLOCK) {
        return true;
    }
    /* A turn withheld for the gate and never scanned has no verdict, and no
     * verdict is not a pass. */
    if (scan == NULL) {
        return false;
    }
    return !scan->blocked;
}

char *ds4_agent_epistemic_repair_guidance(const ds4_epistemic_scan_result *scan)
{
    if (scan == NULL || scan->finding_count <= 0) {
        return NULL;
    }

    static const char header[] =
        "EPISTEMIC_GATE: " DS4_EPI_VERDICT_BLOCK_UNSUPPORTED "\n"
        "Your answer was not published. This turn observed no evidence for the wording below.\n"
        "This is not a finding that those statements are false. It is that nothing this turn "
        "observed supports them.\n\n";
    static const char footer[] =
        "\nDo one of two things and nothing else: run the tool that would produce the missing "
        "evidence and answer from its result, or restate the passage as unverified and say what "
        "would settle it.\n"
        "Do not repeat the wording without the evidence, and do not describe evidence you did "
        "not obtain.\n";

    size_t cap = sizeof(header) + sizeof(footer) + 1;
    for (int i = 0; i < scan->finding_count; i++) {
        const ds4_epistemic_finding *f = &scan->findings[i];
        cap += strlen(f->code) + strlen(f->name) + strlen(f->match) +
               strlen(f->requirement) + 64;
    }

    char *out = malloc(cap);
    if (out == NULL) {
        return NULL;
    }

    size_t used = 0;
    int n = snprintf(out + used, cap - used, "%s", header);
    if (n > 0) {
        used += (size_t)n;
    }
    for (int i = 0; i < scan->finding_count && used < cap; i++) {
        const ds4_epistemic_finding *f = &scan->findings[i];
        n = snprintf(out + used, cap - used, "- %s %s: \"%s\" promises %s, which this turn does not have.\n",
                     f->code, f->name, f->match, f->requirement);
        if (n > 0) {
            used += (size_t)n;
        }
    }
    if (used < cap) {
        snprintf(out + used, cap - used, "%s", footer);
    }
    return out;
}
