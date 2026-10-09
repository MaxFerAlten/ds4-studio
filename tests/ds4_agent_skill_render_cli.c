/*
 * WP3 conformance driver of convergenza.loop.md.
 *
 * Loads skills from disk into a real ds4_agent_skill_registry and prints what
 * the C loop would put in the system prompt, so the Node registry
 * (frontend/server/skillRegistry.mjs) can be compared against this binary on
 * identical inputs:
 *
 *   tests/ds4_agent_skill_render_cli <skills-dir> <skill> [<skill> ...]
 *
 * stdout is the rendered block, then a "--AGG--" separator and the aggregate
 * revision.  Anything the loader rejects goes to stderr and exits non-zero: a
 * conformance run must never see a partial render.
 */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ds4_agent_skill_registry.h"

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <skills-dir> [skill ...]\n", argv[0]);
        return 2;
    }

    const char *skills_root = argv[1];
    ds4_agent_skill_registry registry;
    ds4_agent_skill_registry_init(&registry);
    char err[256];

    for (int i = 2; i < argc; i++) {
        ds4_agent_skill_entry entry;
        memset(&entry, 0, sizeof(entry));
        if (!ds4_agent_skill_stage_from_disk(skills_root, argv[i],
                                             DS4_AGENT_SKILL_DYNAMIC, &entry,
                                             err, sizeof(err))) {
            fprintf(stderr, "stage %s: %s\n", argv[i], err);
            ds4_agent_skill_registry_free(&registry);
            return 1;
        }
        bool changed = false;
        if (!ds4_agent_skill_registry_upsert(&registry, &entry, &changed,
                                             err, sizeof(err))) {
            /* upsert keeps the staged entry on failure, so free it here. */
            fprintf(stderr, "upsert %s: %s\n", argv[i], err);
            ds4_agent_skill_entry_free(&entry);
            ds4_agent_skill_registry_free(&registry);
            return 1;
        }
    }

    char *text = NULL;
    size_t bytes = 0;
    if (!ds4_agent_skill_registry_render(&registry, &text, &bytes, err,
                                         sizeof(err))) {
        fprintf(stderr, "render: %s\n", err);
        ds4_agent_skill_registry_free(&registry);
        return 1;
    }
    fwrite(text, 1, bytes, stdout);
    printf("\n--AGG--\n%s\n", registry.aggregate_revision);

    free(text);
    ds4_agent_skill_registry_free(&registry);
    return 0;
}
