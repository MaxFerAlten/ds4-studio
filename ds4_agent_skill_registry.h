#ifndef DS4_AGENT_SKILL_REGISTRY_H
#define DS4_AGENT_SKILL_REGISTRY_H

#include <stdbool.h>
#include <stddef.h>

#define DS4_AGENT_SKILL_NAME_MAX 64
#define DS4_AGENT_SKILL_FILE_MAX (256u * 1024u)
#define DS4_AGENT_SKILL_ACTIVE_MAX 32
#define DS4_AGENT_SKILL_TOTAL_MAX (1024u * 1024u)
#define DS4_AGENT_SKILL_REVISION_HEX 40
#define DS4_AGENT_SKILL_MANIFEST_MAX (64u * 1024u)

typedef enum {
    DS4_AGENT_SKILL_DYNAMIC = 0,
    DS4_AGENT_SKILL_BUILTIN_METACOGNITION,
    DS4_AGENT_SKILL_BUILTIN_SOUL,
    DS4_AGENT_SKILL_BUILTIN_ETHIC,
    DS4_AGENT_SKILL_BUILTIN_STRUCTURE,
    DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY,
    DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY
} ds4_agent_skill_kind;

typedef struct {
    const char *fragment_name;
    bool fragment_enabled;
    bool fragment_required;
    const char *fragment_begin_marker;
    const char *fragment_end_marker;
} ds4_agent_skill_stage_options;

typedef struct {
    char name[DS4_AGENT_SKILL_NAME_MAX + 1];
    char *content;
    size_t content_len;
    char revision[DS4_AGENT_SKILL_REVISION_HEX + 1];
    ds4_agent_skill_kind kind;
} ds4_agent_skill_entry;

typedef struct {
    ds4_agent_skill_entry *items;
    size_t len;
    size_t cap;
    size_t total_bytes;
    char aggregate_revision[DS4_AGENT_SKILL_REVISION_HEX + 1];
} ds4_agent_skill_registry;

typedef struct {
    char name[DS4_AGENT_SKILL_NAME_MAX + 1];
    ds4_agent_skill_kind kind;
    char revision[DS4_AGENT_SKILL_REVISION_HEX + 1];
    size_t content_len;
} ds4_agent_skill_manifest_item;

typedef struct {
    ds4_agent_skill_manifest_item items[DS4_AGENT_SKILL_ACTIVE_MAX];
    size_t len;
    char aggregate_revision[DS4_AGENT_SKILL_REVISION_HEX + 1];
} ds4_agent_skill_manifest;

void ds4_agent_skill_registry_init(ds4_agent_skill_registry *registry);
void ds4_agent_skill_registry_free(ds4_agent_skill_registry *registry);
void ds4_agent_skill_entry_free(ds4_agent_skill_entry *entry);

bool ds4_agent_skill_name_valid(const char *name, char *err, size_t err_len);
bool ds4_agent_skill_stage_from_disk(const char *skills_root,
                                     const char *name,
                                     ds4_agent_skill_kind kind,
                                     ds4_agent_skill_entry *out,
                                     char *err,
                                     size_t err_len);
bool ds4_agent_skill_stage_from_disk_ex(
    const char *skills_root,
    const char *name,
    ds4_agent_skill_kind kind,
    const ds4_agent_skill_stage_options *options,
    ds4_agent_skill_entry *out,
    char *err,
    size_t err_len);

const ds4_agent_skill_entry *
ds4_agent_skill_registry_find(const ds4_agent_skill_registry *registry,
                              const char *name);
bool ds4_agent_skill_registry_upsert(ds4_agent_skill_registry *registry,
                                     ds4_agent_skill_entry *staged,
                                     bool *changed,
                                     char *err,
                                     size_t err_len);
bool ds4_agent_skill_registry_remove(ds4_agent_skill_registry *registry,
                                     const char *name,
                                     bool *changed);
bool ds4_agent_skill_registry_clone(const ds4_agent_skill_registry *src,
                                    ds4_agent_skill_registry *dst,
                                    char *err,
                                    size_t err_len);
void ds4_agent_skill_registry_swap(ds4_agent_skill_registry *a,
                                   ds4_agent_skill_registry *b);
bool ds4_agent_skill_registry_render(const ds4_agent_skill_registry *registry,
                                     char **text_out,
                                     size_t *bytes_out,
                                     char *err,
                                     size_t err_len);

void ds4_agent_skill_manifest_init(ds4_agent_skill_manifest *manifest);
bool ds4_agent_skill_manifest_add(ds4_agent_skill_manifest *manifest,
                                  const char *name,
                                  ds4_agent_skill_kind kind,
                                  const char revision[DS4_AGENT_SKILL_REVISION_HEX + 1],
                                  size_t content_len,
                                  char *err,
                                  size_t err_len);
bool ds4_agent_skill_manifest_stage_write(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    const ds4_agent_skill_manifest *manifest,
    char **temp_path_out,
    char *err,
    size_t err_len);
bool ds4_agent_skill_manifest_commit(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    char **temp_path,
    char *err,
    size_t err_len);
void ds4_agent_skill_manifest_abort(char **temp_path);
bool ds4_agent_skill_manifest_read(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    ds4_agent_skill_manifest *manifest,
    bool *found,
    char *err,
    size_t err_len);
bool ds4_agent_skill_manifest_remove(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    bool *removed,
    char *err,
    size_t err_len);
const char *ds4_agent_skill_kind_name(ds4_agent_skill_kind kind);

#endif
