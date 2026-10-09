/* Aggregate revision of the dynamic skill registry.
 *
 * The aggregate hashes per-skill metadata (name, kind, length, content
 * revision).  It used to be built in a fixed 8192-byte buffer that silently
 * cleared the revision on overflow; it is now sized from the registry limits.
 * These tests pin the observable contract: any registry the API can build has
 * a 40-hex revision, whatever the size of the skills it holds.
 *
 *   make -f Makefile.studio tests/ds4_agent_skill_registry_test
 */
#include "ds4_agent_skill_registry.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int failures;

#define CHECK(expr) do { \
    if (!(expr)) { \
        fprintf(stderr, "%s:%d: assertion failed: %s\n", \
                __FILE__, __LINE__, #expr); \
        failures++; \
    } \
} while (0)

static char root[256];

static void write_skill(const char *name, size_t bytes, char fill) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", root, name);
    mkdir(path, 0700);
    snprintf(path, sizeof(path), "%s/%s/SKILL.md", root, name);
    FILE *fp = fopen(path, "wb");
    if (!fp) { perror(path); exit(2); }
    fputs("# skill\n", fp);
    for (size_t i = 8; i + 1 < bytes; i++) fputc(i % 64 == 63 ? '\n' : fill, fp);
    fputc('\n', fp);
    fclose(fp);
}

static bool load(ds4_agent_skill_registry *r, const char *name) {
    ds4_agent_skill_entry staged = {0};
    char err[256] = {0};
    bool changed = false;
    if (!ds4_agent_skill_stage_from_disk(root, name, DS4_AGENT_SKILL_DYNAMIC,
                                         &staged, err, sizeof(err)) ||
        !ds4_agent_skill_registry_upsert(r, &staged, &changed, err, sizeof(err))) {
        fprintf(stderr, "load %s: %s\n", name, err);
        ds4_agent_skill_entry_free(&staged);
        return false;
    }
    return true;
}

static bool revision_valid(const ds4_agent_skill_registry *r) {
    if (strlen(r->aggregate_revision) != 40) return false;
    for (size_t i = 0; i < 40; i++)
        if (!strchr("0123456789abcdef", r->aggregate_revision[i])) return false;
    return true;
}

static void test_small_registry(void) {
    ds4_agent_skill_registry r;
    ds4_agent_skill_registry_init(&r);
    CHECK(revision_valid(&r)); /* empty registry: still a real revision */
    char empty[41];
    memcpy(empty, r.aggregate_revision, sizeof(empty));
    CHECK(load(&r, "small"));
    CHECK(revision_valid(&r));
    CHECK(strcmp(empty, r.aggregate_revision) != 0);
    ds4_agent_skill_registry_free(&r);
}

static void test_large_content(size_t bytes, const char *name) {
    write_skill(name, bytes, 'x');
    ds4_agent_skill_registry r;
    ds4_agent_skill_registry_init(&r);
    CHECK(load(&r, name));
    CHECK(r.total_bytes >= bytes - 1);
    CHECK(revision_valid(&r));
    ds4_agent_skill_registry_free(&r);
}

/* The worst case the API allows: every slot used, every name at full length. */
static void test_full_registry_with_longest_names(void) {
    ds4_agent_skill_registry r;
    ds4_agent_skill_registry_init(&r);
    for (int i = 0; i < DS4_AGENT_SKILL_ACTIVE_MAX; i++) {
        char name[DS4_AGENT_SKILL_NAME_MAX + 1];
        memset(name, 'a', DS4_AGENT_SKILL_NAME_MAX);
        name[DS4_AGENT_SKILL_NAME_MAX] = '\0';
        snprintf(name + DS4_AGENT_SKILL_NAME_MAX - 3, 4, "%03d", i);
        write_skill(name, 20000, (char)('a' + i % 26));
        CHECK(load(&r, name));
    }
    CHECK(r.len == DS4_AGENT_SKILL_ACTIVE_MAX);
    CHECK(revision_valid(&r));
    ds4_agent_skill_registry_free(&r);
}

static void test_same_content_same_revision(void) {
    ds4_agent_skill_registry a, b;
    ds4_agent_skill_registry_init(&a);
    ds4_agent_skill_registry_init(&b);
    CHECK(load(&a, "small"));
    CHECK(load(&a, "large-40k"));
    /* Insertion order differs; the registry is name-sorted, so the
     * prompt order -- and therefore the revision -- does not. */
    CHECK(load(&b, "large-40k"));
    CHECK(load(&b, "small"));
    CHECK(revision_valid(&a) && revision_valid(&b));
    CHECK(!strcmp(a.aggregate_revision, b.aggregate_revision));
    ds4_agent_skill_registry_free(&a);
    ds4_agent_skill_registry_free(&b);
}

static void test_content_change_changes_revision(void) {
    ds4_agent_skill_registry r;
    ds4_agent_skill_registry_init(&r);
    write_skill("mutable", 9000, 'p');
    CHECK(load(&r, "mutable"));
    char before[41];
    memcpy(before, r.aggregate_revision, sizeof(before));
    write_skill("mutable", 9000, 'q'); /* same length, different bytes */
    CHECK(load(&r, "mutable"));
    CHECK(revision_valid(&r));
    CHECK(strcmp(before, r.aggregate_revision) != 0);
    ds4_agent_skill_registry_free(&r);
}

static void test_remove_keeps_revision(void) {
    ds4_agent_skill_registry r;
    ds4_agent_skill_registry_init(&r);
    CHECK(load(&r, "small"));
    CHECK(load(&r, "large-40k"));
    bool changed = false;
    CHECK(ds4_agent_skill_registry_remove(&r, "large-40k", &changed));
    CHECK(changed);
    CHECK(r.len == 1);
    CHECK(revision_valid(&r));
    ds4_agent_skill_registry_free(&r);
}

int main(void) {
    snprintf(root, sizeof(root), "/tmp/ds4-skill-registry-test-%ld", (long)getpid());
    if (mkdir(root, 0700) != 0) { perror(root); return 2; }
    write_skill("small", 200, 's');
    test_small_registry();
    test_large_content(9 * 1024, "large-9k");      /* > 8 KiB */
    test_large_content(40 * 1024, "large-40k");    /* > 32 KiB */
    test_same_content_same_revision();
    test_content_change_changes_revision();
    test_remove_keeps_revision();
    test_full_registry_with_longest_names();
    char cmd[300];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", root);
    if (system(cmd) != 0) fprintf(stderr, "cleanup failed: %s\n", root);
    if (failures) {
        fprintf(stderr, "skill registry tests: %d failure(s)\n", failures);
        return 1;
    }
    puts("skill registry tests: ok");
    return 0;
}
