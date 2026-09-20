#include "ds4_agent_skill_registry.h"

#include "ds4_kvstore.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} skill_buffer;

static void skill_set_error(char *err, size_t err_len, const char *fmt, ...) {
    if (!err || !err_len) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(err, err_len, fmt, ap);
    va_end(ap);
}

static bool skill_buffer_reserve(skill_buffer *buffer, size_t extra) {
    if (extra > SIZE_MAX - buffer->len - 1) return false;
    size_t need = buffer->len + extra + 1;
    if (need <= buffer->cap) return true;
    size_t cap = buffer->cap ? buffer->cap : 256;
    while (cap < need) {
        if (cap > SIZE_MAX / 2) {
            cap = need;
            break;
        }
        cap *= 2;
    }
    char *next = realloc(buffer->ptr, cap);
    if (!next) return false;
    buffer->ptr = next;
    buffer->cap = cap;
    return true;
}

static bool skill_buffer_append(skill_buffer *buffer,
                                const void *data,
                                size_t len) {
    if (!skill_buffer_reserve(buffer, len)) return false;
    if (len) memcpy(buffer->ptr + buffer->len, data, len);
    buffer->len += len;
    buffer->ptr[buffer->len] = '\0';
    return true;
}

static bool skill_buffer_puts(skill_buffer *buffer, const char *text) {
    return skill_buffer_append(buffer, text, strlen(text));
}

static bool skill_utf8_valid(const unsigned char *data, size_t len) {
    size_t i = 0;
    while (i < len) {
        unsigned char c = data[i++];
        if (c <= 0x7f) continue;
        if (c >= 0xc2 && c <= 0xdf) {
            if (i >= len || (data[i++] & 0xc0) != 0x80) return false;
            continue;
        }
        if (c >= 0xe0 && c <= 0xef) {
            if (i + 1 >= len) return false;
            unsigned char c1 = data[i++];
            unsigned char c2 = data[i++];
            if ((c2 & 0xc0) != 0x80) return false;
            if (c == 0xe0) {
                if (c1 < 0xa0 || c1 > 0xbf) return false;
            } else if (c == 0xed) {
                if (c1 < 0x80 || c1 > 0x9f) return false;
            } else if ((c1 & 0xc0) != 0x80) {
                return false;
            }
            continue;
        }
        if (c >= 0xf0 && c <= 0xf4) {
            if (i + 2 >= len) return false;
            unsigned char c1 = data[i++];
            unsigned char c2 = data[i++];
            unsigned char c3 = data[i++];
            if ((c2 & 0xc0) != 0x80 || (c3 & 0xc0) != 0x80) return false;
            if (c == 0xf0) {
                if (c1 < 0x90 || c1 > 0xbf) return false;
            } else if (c == 0xf4) {
                if (c1 < 0x80 || c1 > 0x8f) return false;
            } else if ((c1 & 0xc0) != 0x80) {
                return false;
            }
            continue;
        }
        return false;
    }
    return true;
}

static bool skill_content_nonempty(const char *content, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)content[i];
        if (c >= 0x80 || !isspace(c)) return true;
    }
    return false;
}

static bool skill_has_reserved_marker(const char *content, size_t len) {
    static const char begin[] = "[BEGIN DS4 ACTIVE SKILL";
    static const char end[] = "[END DS4 ACTIVE SKILL";
    size_t pos = 0;
    while (pos < len) {
        size_t line_end = pos;
        while (line_end < len && content[line_end] != '\n') line_end++;
        size_t line_len = line_end - pos;
        if ((line_len >= sizeof(begin) - 1 &&
             !memcmp(content + pos, begin, sizeof(begin) - 1)) ||
            (line_len >= sizeof(end) - 1 &&
             !memcmp(content + pos, end, sizeof(end) - 1)))
            return true;
        pos = line_end < len ? line_end + 1 : len;
    }
    return false;
}

static bool skill_stat_unchanged(const struct stat *before,
                                 const struct stat *after) {
    if (before->st_dev != after->st_dev ||
        before->st_ino != after->st_ino ||
        before->st_size != after->st_size ||
        before->st_mtime != after->st_mtime)
        return false;
#if defined(__APPLE__)
    return before->st_mtimespec.tv_nsec == after->st_mtimespec.tv_nsec;
#else
    return before->st_mtim.tv_nsec == after->st_mtim.tv_nsec;
#endif
}

static void skill_registry_revise(ds4_agent_skill_registry *registry) {
    unsigned char canonical[8192];
    size_t used = 0;
    static const char magic[] = "DS4_AGENT_SKILL_REGISTRY_V1";
    memcpy(canonical + used, magic, sizeof(magic));
    used += sizeof(magic);
    for (size_t i = 0; i < registry->len; i++) {
        const ds4_agent_skill_entry *entry = &registry->items[i];
        char kind[24];
        char bytes[32];
        int kind_len = snprintf(kind, sizeof(kind), "%d", (int)entry->kind);
        int bytes_len = snprintf(bytes, sizeof(bytes), "%zu", entry->content_len);
        size_t name_len = strlen(entry->name);
        size_t revision_len = strlen(entry->revision);
        size_t need = name_len + 1 + (size_t)kind_len + 1 +
                      (size_t)bytes_len + 1 + revision_len + 1;
        if (kind_len < 0 || bytes_len < 0 ||
            need > sizeof(canonical) - used) {
            registry->aggregate_revision[0] = '\0';
            return;
        }
        memcpy(canonical + used, entry->name, name_len + 1);
        used += name_len + 1;
        memcpy(canonical + used, kind, (size_t)kind_len + 1);
        used += (size_t)kind_len + 1;
        memcpy(canonical + used, bytes, (size_t)bytes_len + 1);
        used += (size_t)bytes_len + 1;
        memcpy(canonical + used, entry->revision, revision_len + 1);
        used += revision_len + 1;
    }
    ds4_kvstore_sha1_bytes_hex(canonical, used,
                               registry->aggregate_revision);
}

void ds4_agent_skill_registry_init(ds4_agent_skill_registry *registry) {
    if (!registry) return;
    memset(registry, 0, sizeof(*registry));
    skill_registry_revise(registry);
}

void ds4_agent_skill_entry_free(ds4_agent_skill_entry *entry) {
    if (!entry) return;
    free(entry->content);
    memset(entry, 0, sizeof(*entry));
}

void ds4_agent_skill_registry_free(ds4_agent_skill_registry *registry) {
    if (!registry) return;
    for (size_t i = 0; i < registry->len; i++)
        ds4_agent_skill_entry_free(&registry->items[i]);
    free(registry->items);
    memset(registry, 0, sizeof(*registry));
}

bool ds4_agent_skill_name_valid(const char *name, char *err, size_t err_len) {
    if (!name) {
        skill_set_error(err, err_len,
                        "SKILL_NAME_INVALID: skill name is missing");
        return false;
    }
    size_t len = strnlen(name, DS4_AGENT_SKILL_NAME_MAX + 1);
    if (len == 0 || len > DS4_AGENT_SKILL_NAME_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_NAME_INVALID: skill name must contain 1..64 bytes");
        return false;
    }
    unsigned char first = (unsigned char)name[0];
    if (!((first >= 'a' && first <= 'z') ||
          (first >= '0' && first <= '9'))) {
        skill_set_error(err, err_len,
                        "SKILL_NAME_INVALID: skill name must start with lowercase ASCII or a digit");
        return false;
    }
    for (size_t i = 1; i < len; i++) {
        unsigned char c = (unsigned char)name[i];
        if ((c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-')
            continue;
        skill_set_error(err, err_len,
                        "SKILL_NAME_INVALID: skill name contains a forbidden byte");
        return false;
    }
    if (err && err_len) err[0] = '\0';
    return true;
}

static bool skill_stage_base_from_disk(const char *skills_root,
                                       const char *name,
                                       ds4_agent_skill_kind kind,
                                       ds4_agent_skill_entry *out,
                                       char *err,
                                       size_t err_len) {
    if (!out) {
        skill_set_error(err, err_len,
                        "SKILL_IO_FAILED: output entry is missing");
        return false;
    }
    memset(out, 0, sizeof(*out));
    if (!ds4_agent_skill_name_valid(name, err, err_len)) return false;
    if (!skills_root || !skills_root[0]) skills_root = "skills";

    char root_real[PATH_MAX];
    if (!realpath(skills_root, root_real)) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: %s",
                        strerror(errno));
        return false;
    }

    int root_fd = -1;
    int dir_fd = -1;
    int file_fd = -1;
    char *content = NULL;
    bool ok = false;
    struct stat root_stat;
    struct stat dir_lstat;
    struct stat dir_stat;
    struct stat file_lstat;
    struct stat before;
    struct stat after;

    root_fd = open(root_real, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (root_fd < 0 || fstat(root_fd, &root_stat) != 0 ||
        !S_ISDIR(root_stat.st_mode)) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: invalid skills root");
        goto done;
    }
    if (fstatat(root_fd, name, &dir_lstat, AT_SYMLINK_NOFOLLOW) != 0) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: %s",
                        strerror(errno));
        goto done;
    }
    if (S_ISLNK(dir_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_SYMLINK_REJECTED: skill directory is a symlink");
        goto done;
    }
    dir_fd = openat(root_fd, name,
                    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (dir_fd < 0 || fstat(dir_fd, &dir_stat) != 0 ||
        !S_ISDIR(dir_stat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_NOT_FOUND: skill directory is unavailable");
        goto done;
    }
    if (fstatat(dir_fd, "SKILL.md", &file_lstat,
                AT_SYMLINK_NOFOLLOW) != 0) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: %s",
                        strerror(errno));
        goto done;
    }
    if (S_ISLNK(file_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_SYMLINK_REJECTED: SKILL.md is a symlink");
        goto done;
    }
    if (!S_ISREG(file_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_INVALID: SKILL.md must be a regular file");
        goto done;
    }
    file_fd = openat(dir_fd, "SKILL.md",
                     O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file_fd < 0 || fstat(file_fd, &before) != 0) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: %s",
                        strerror(errno));
        goto done;
    }
    if (!S_ISREG(before.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_INVALID: SKILL.md must be a regular file");
        goto done;
    }
    if (before.st_size <= 0) {
        skill_set_error(err, err_len,
                        "SKILL_EMPTY: SKILL.md is empty");
        goto done;
    }
    if ((uintmax_t)before.st_size > DS4_AGENT_SKILL_FILE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_TOO_LARGE: SKILL.md exceeds 256 KiB");
        goto done;
    }

    size_t content_len = (size_t)before.st_size;
    content = malloc(content_len + 1);
    if (!content) {
        skill_set_error(err, err_len,
                        "SKILL_IO_FAILED: allocation failed");
        goto done;
    }
    size_t used = 0;
    while (used < content_len) {
        ssize_t got = read(file_fd, content + used, content_len - used);
        if (got < 0) {
            if (errno == EINTR) continue;
            skill_set_error(err, err_len, "SKILL_IO_FAILED: %s",
                            strerror(errno));
            goto done;
        }
        if (got == 0) {
            skill_set_error(err, err_len,
                            "SKILL_CHANGED_DURING_READ: early EOF");
            goto done;
        }
        used += (size_t)got;
    }
    if (fstat(file_fd, &after) != 0 ||
        !skill_stat_unchanged(&before, &after)) {
        skill_set_error(err, err_len,
                        "SKILL_CHANGED_DURING_READ: SKILL.md changed while reading");
        goto done;
    }
    content[content_len] = '\0';
    if (memchr(content, '\0', content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_NUL_BYTE: SKILL.md contains NUL");
        goto done;
    }
    if (!skill_utf8_valid((const unsigned char *)content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_UTF8_INVALID: SKILL.md is not valid UTF-8");
        goto done;
    }
    if (!skill_content_nonempty(content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_EMPTY: SKILL.md contains only whitespace");
        goto done;
    }
    if (skill_has_reserved_marker(content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_RESERVED_MARKER: SKILL.md contains a reserved marker");
        goto done;
    }

    memcpy(out->name, name, strlen(name) + 1);
    out->content = content;
    out->content_len = content_len;
    out->kind = kind;
    ds4_kvstore_sha1_bytes_hex(content, content_len, out->revision);
    content = NULL;
    if (err && err_len) err[0] = '\0';
    ok = true;

done:
    free(content);
    if (file_fd >= 0) close(file_fd);
    if (dir_fd >= 0) close(dir_fd);
    if (root_fd >= 0) close(root_fd);
    if (!ok) ds4_agent_skill_entry_free(out);
    return ok;
}

static bool skill_fragment_name_valid(const char *name) {
    if (!name || !name[0] || strlen(name) > NAME_MAX) return false;
    if (!strcmp(name, ".") || !strcmp(name, "..")) return false;
    return !strchr(name, '/') && !strchr(name, '\\');
}

static bool skill_read_fragment_from_disk(
    const char *skills_root,
    const char *skill_name,
    const char *fragment_name,
    bool required,
    char **content_out,
    size_t *content_len_out,
    char *err,
    size_t err_len) {
    int root_fd = -1;
    int dir_fd = -1;
    int file_fd = -1;
    char *content = NULL;
    bool ok = false;
    char root_real[PATH_MAX];
    struct stat dir_lstat;
    struct stat file_lstat;
    struct stat before;
    struct stat after;

    *content_out = NULL;
    *content_len_out = 0;
    if (!skill_fragment_name_valid(fragment_name)) {
        skill_set_error(err, err_len,
                        "SKILL_FRAGMENT_INVALID: fragment name must be a file name");
        return false;
    }
    if (!skills_root || !skills_root[0]) skills_root = "skills";
    if (!realpath(skills_root, root_real)) {
        skill_set_error(err, err_len, "SKILL_NOT_FOUND: %s", strerror(errno));
        return false;
    }

    root_fd = open(root_real, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (root_fd < 0 ||
        fstatat(root_fd, skill_name, &dir_lstat, AT_SYMLINK_NOFOLLOW) != 0 ||
        S_ISLNK(dir_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_NOT_FOUND: skill directory is unavailable");
        goto done;
    }
    dir_fd = openat(root_fd, skill_name,
                    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (dir_fd < 0) {
        skill_set_error(err, err_len,
                        "SKILL_NOT_FOUND: skill directory is unavailable");
        goto done;
    }
    if (fstatat(dir_fd, fragment_name, &file_lstat,
                AT_SYMLINK_NOFOLLOW) != 0) {
        if (errno == ENOENT && !required) {
            ok = true;
            goto done;
        }
        skill_set_error(err, err_len, "SKILL_FRAGMENT_NOT_FOUND: %s",
                        strerror(errno));
        goto done;
    }
    if (S_ISLNK(file_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_SYMLINK_REJECTED: fragment is a symlink");
        goto done;
    }
    if (!S_ISREG(file_lstat.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_INVALID: fragment must be a regular file");
        goto done;
    }
    file_fd = openat(dir_fd, fragment_name,
                     O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file_fd < 0 || fstat(file_fd, &before) != 0 ||
        !S_ISREG(before.st_mode)) {
        skill_set_error(err, err_len,
                        "SKILL_FRAGMENT_NOT_FOUND: fragment is unavailable");
        goto done;
    }
    if (before.st_size <= 0) {
        skill_set_error(err, err_len, "SKILL_EMPTY: fragment is empty");
        goto done;
    }
    if ((uintmax_t)before.st_size > DS4_AGENT_SKILL_FILE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_TOO_LARGE: fragment exceeds 256 KiB");
        goto done;
    }

    size_t content_len = (size_t)before.st_size;
    content = malloc(content_len + 1);
    if (!content) {
        skill_set_error(err, err_len, "SKILL_IO_FAILED: allocation failed");
        goto done;
    }
    size_t used = 0;
    while (used < content_len) {
        ssize_t got = read(file_fd, content + used, content_len - used);
        if (got < 0) {
            if (errno == EINTR) continue;
            skill_set_error(err, err_len, "SKILL_IO_FAILED: %s",
                            strerror(errno));
            goto done;
        }
        if (got == 0) {
            skill_set_error(err, err_len,
                            "SKILL_CHANGED_DURING_READ: early EOF");
            goto done;
        }
        used += (size_t)got;
    }
    if (fstat(file_fd, &after) != 0 ||
        !skill_stat_unchanged(&before, &after)) {
        skill_set_error(err, err_len,
                        "SKILL_CHANGED_DURING_READ: fragment changed while reading");
        goto done;
    }
    content[content_len] = '\0';
    if (memchr(content, '\0', content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_NUL_BYTE: fragment contains NUL");
        goto done;
    }
    if (!skill_utf8_valid((const unsigned char *)content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_UTF8_INVALID: fragment is not valid UTF-8");
        goto done;
    }
    if (!skill_content_nonempty(content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_EMPTY: fragment contains only whitespace");
        goto done;
    }
    if (skill_has_reserved_marker(content, content_len)) {
        skill_set_error(err, err_len,
                        "SKILL_RESERVED_MARKER: fragment contains a reserved marker");
        goto done;
    }

    *content_out = content;
    *content_len_out = content_len;
    content = NULL;
    ok = true;

done:
    free(content);
    if (file_fd >= 0) close(file_fd);
    if (dir_fd >= 0) close(dir_fd);
    if (root_fd >= 0) close(root_fd);
    return ok;
}

bool ds4_agent_skill_stage_from_disk_ex(
    const char *skills_root,
    const char *name,
    ds4_agent_skill_kind kind,
    const ds4_agent_skill_stage_options *options,
    ds4_agent_skill_entry *out,
    char *err,
    size_t err_len) {
    if (options && options->fragment_required && !options->fragment_enabled) {
        skill_set_error(err, err_len,
                        "SKILL_FRAGMENT_CONFIG_INVALID: required fragment is disabled");
        if (out) memset(out, 0, sizeof(*out));
        return false;
    }
    if (!skill_stage_base_from_disk(skills_root, name, kind,
                                    out, err, err_len))
        return false;
    if (!options || !options->fragment_enabled) return true;
    if (!options->fragment_begin_marker ||
        !options->fragment_begin_marker[0] ||
        !options->fragment_end_marker ||
        !options->fragment_end_marker[0]) {
        skill_set_error(err, err_len,
                        "SKILL_FRAGMENT_CONFIG_INVALID: markers are required");
        ds4_agent_skill_entry_free(out);
        return false;
    }

    char *fragment = NULL;
    size_t fragment_len = 0;
    if (!skill_read_fragment_from_disk(
            skills_root, name, options->fragment_name,
            options->fragment_required, &fragment, &fragment_len,
            err, err_len)) {
        ds4_agent_skill_entry_free(out);
        return false;
    }
    if (!fragment) return true;
    if (strstr(out->content, options->fragment_begin_marker) ||
        strstr(out->content, options->fragment_end_marker) ||
        strstr(fragment, options->fragment_begin_marker) ||
        strstr(fragment, options->fragment_end_marker)) {
        skill_set_error(err, err_len,
                        "SKILL_RESERVED_MARKER: autonomous marker already present");
        free(fragment);
        ds4_agent_skill_entry_free(out);
        return false;
    }

    skill_buffer assembled = {0};
    bool assembled_ok =
        skill_buffer_append(&assembled, out->content, out->content_len) &&
        skill_buffer_puts(&assembled, "\n\n") &&
        skill_buffer_puts(&assembled, options->fragment_begin_marker) &&
        skill_buffer_puts(&assembled, "\n") &&
        skill_buffer_append(&assembled, fragment, fragment_len) &&
        skill_buffer_puts(&assembled, "\n") &&
        skill_buffer_puts(&assembled, options->fragment_end_marker) &&
        skill_buffer_puts(&assembled, "\n");
    free(fragment);
    if (!assembled_ok) {
        skill_set_error(err, err_len, "SKILL_IO_FAILED: allocation failed");
        free(assembled.ptr);
        ds4_agent_skill_entry_free(out);
        return false;
    }
    if (assembled.len > DS4_AGENT_SKILL_FILE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_FILE_TOO_LARGE: assembled policy exceeds 256 KiB");
        free(assembled.ptr);
        ds4_agent_skill_entry_free(out);
        return false;
    }

    free(out->content);
    out->content = assembled.ptr;
    out->content_len = assembled.len;
    ds4_kvstore_sha1_bytes_hex(out->content, out->content_len, out->revision);
    if (err && err_len) err[0] = '\0';
    return true;
}

bool ds4_agent_skill_stage_from_disk(const char *skills_root,
                                     const char *name,
                                     ds4_agent_skill_kind kind,
                                     ds4_agent_skill_entry *out,
                                     char *err,
                                     size_t err_len) {
    return ds4_agent_skill_stage_from_disk_ex(
        skills_root, name, kind, NULL, out, err, err_len);
}

static size_t skill_registry_lower_bound(
    const ds4_agent_skill_registry *registry,
    const char *name,
    bool *found) {
    size_t lo = 0;
    size_t hi = registry->len;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        int cmp = strcmp(registry->items[mid].name, name);
        if (cmp < 0) lo = mid + 1;
        else hi = mid;
    }
    if (found)
        *found = lo < registry->len &&
                 !strcmp(registry->items[lo].name, name);
    return lo;
}

const ds4_agent_skill_entry *
ds4_agent_skill_registry_find(const ds4_agent_skill_registry *registry,
                              const char *name) {
    if (!registry || !name) return NULL;
    bool found = false;
    size_t pos = skill_registry_lower_bound(registry, name, &found);
    return found ? &registry->items[pos] : NULL;
}

bool ds4_agent_skill_registry_upsert(ds4_agent_skill_registry *registry,
                                     ds4_agent_skill_entry *staged,
                                     bool *changed,
                                     char *err,
                                     size_t err_len) {
    if (changed) *changed = false;
    if (!registry || !staged || !staged->content ||
        !ds4_agent_skill_name_valid(staged->name, err, err_len)) {
        if (registry && staged && !staged->content)
            skill_set_error(err, err_len,
                            "SKILL_IO_FAILED: staged entry has no content");
        return false;
    }
    bool found = false;
    size_t pos = skill_registry_lower_bound(registry, staged->name, &found);
    if (found &&
        registry->items[pos].kind == staged->kind &&
        registry->items[pos].content_len == staged->content_len &&
        !strcmp(registry->items[pos].revision, staged->revision)) {
        ds4_agent_skill_entry_free(staged);
        return true;
    }

    size_t old_bytes = found ? registry->items[pos].content_len : 0;
    if (!found && registry->len >= DS4_AGENT_SKILL_ACTIVE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_ACTIVE_LIMIT: at most 32 skills may be active");
        return false;
    }
    if (staged->content_len > DS4_AGENT_SKILL_TOTAL_MAX ||
        registry->total_bytes - old_bytes >
            DS4_AGENT_SKILL_TOTAL_MAX - staged->content_len) {
        skill_set_error(err, err_len,
                        "SKILL_TOTAL_TOO_LARGE: active skills exceed 1 MiB");
        return false;
    }

    if (!found && registry->len == registry->cap) {
        size_t next_cap = registry->cap ? registry->cap * 2 : 4;
        if (next_cap > DS4_AGENT_SKILL_ACTIVE_MAX)
            next_cap = DS4_AGENT_SKILL_ACTIVE_MAX;
        ds4_agent_skill_entry *next =
            realloc(registry->items, next_cap * sizeof(*next));
        if (!next) {
            skill_set_error(err, err_len,
                            "SKILL_IO_FAILED: registry allocation failed");
            return false;
        }
        registry->items = next;
        registry->cap = next_cap;
    }

    if (found) {
        ds4_agent_skill_entry_free(&registry->items[pos]);
    } else {
        memmove(&registry->items[pos + 1], &registry->items[pos],
                (registry->len - pos) * sizeof(*registry->items));
        registry->len++;
    }
    registry->items[pos] = *staged;
    memset(staged, 0, sizeof(*staged));
    registry->total_bytes =
        registry->total_bytes - old_bytes + registry->items[pos].content_len;
    skill_registry_revise(registry);
    if (changed) *changed = true;
    if (err && err_len) err[0] = '\0';
    return true;
}

bool ds4_agent_skill_registry_remove(ds4_agent_skill_registry *registry,
                                     const char *name,
                                     bool *changed) {
    if (changed) *changed = false;
    if (!registry || !name) return false;
    bool found = false;
    size_t pos = skill_registry_lower_bound(registry, name, &found);
    if (!found) return true;
    registry->total_bytes -= registry->items[pos].content_len;
    ds4_agent_skill_entry_free(&registry->items[pos]);
    memmove(&registry->items[pos], &registry->items[pos + 1],
            (registry->len - pos - 1) * sizeof(*registry->items));
    registry->len--;
    if (registry->len < registry->cap)
        memset(&registry->items[registry->len], 0,
               sizeof(*registry->items));
    skill_registry_revise(registry);
    if (changed) *changed = true;
    return true;
}

bool ds4_agent_skill_registry_clone(const ds4_agent_skill_registry *src,
                                    ds4_agent_skill_registry *dst,
                                    char *err,
                                    size_t err_len) {
    if (!src || !dst) {
        skill_set_error(err, err_len,
                        "SKILL_IO_FAILED: invalid registry clone");
        return false;
    }
    ds4_agent_skill_registry_init(dst);
    if (!src->len) return true;
    dst->items = calloc(src->len, sizeof(*dst->items));
    if (!dst->items) {
        skill_set_error(err, err_len,
                        "SKILL_IO_FAILED: registry clone allocation failed");
        return false;
    }
    dst->cap = src->len;
    for (size_t i = 0; i < src->len; i++) {
        dst->items[i] = src->items[i];
        dst->items[i].content = malloc(src->items[i].content_len + 1);
        if (!dst->items[i].content) {
            dst->len = i;
            ds4_agent_skill_registry_free(dst);
            skill_set_error(err, err_len,
                            "SKILL_IO_FAILED: registry clone allocation failed");
            return false;
        }
        memcpy(dst->items[i].content, src->items[i].content,
               src->items[i].content_len + 1);
        dst->len = i + 1;
    }
    dst->total_bytes = src->total_bytes;
    memcpy(dst->aggregate_revision, src->aggregate_revision,
           sizeof(dst->aggregate_revision));
    return true;
}

void ds4_agent_skill_registry_swap(ds4_agent_skill_registry *a,
                                   ds4_agent_skill_registry *b) {
    if (!a || !b) return;
    ds4_agent_skill_registry tmp = *a;
    *a = *b;
    *b = tmp;
}

bool ds4_agent_skill_registry_render(const ds4_agent_skill_registry *registry,
                                     char **text_out,
                                     size_t *bytes_out,
                                     char *err,
                                     size_t err_len) {
    if (!registry || !text_out || !bytes_out) {
        skill_set_error(err, err_len,
                        "SKILL_PROMPT_RENDER_FAILED: invalid output");
        return false;
    }
    *text_out = NULL;
    *bytes_out = 0;
    skill_buffer buffer = {0};
    for (size_t i = 0; i < registry->len; i++) {
        const ds4_agent_skill_entry *entry = &registry->items[i];
        char header[192];
        char footer[128];
        int header_len = snprintf(
            header, sizeof(header),
            "[BEGIN DS4 ACTIVE SKILL name=%s revision=%s]\n",
            entry->name, entry->revision);
        int footer_len = snprintf(
            footer, sizeof(footer),
            "[END DS4 ACTIVE SKILL name=%s]", entry->name);
        bool append_ok = header_len > 0 && footer_len > 0 &&
            (size_t)header_len < sizeof(header) &&
            (size_t)footer_len < sizeof(footer);
        if (append_ok && i)
            append_ok = skill_buffer_puts(&buffer, "\n\n");
        if (append_ok)
            append_ok = skill_buffer_append(&buffer, header,
                                             (size_t)header_len);
        if (append_ok)
            append_ok = skill_buffer_append(&buffer, entry->content,
                                             entry->content_len);
        if (append_ok && entry->content_len &&
            entry->content[entry->content_len - 1] != '\n')
            append_ok = skill_buffer_puts(&buffer, "\n");
        if (append_ok)
            append_ok = skill_buffer_append(&buffer, footer,
                                             (size_t)footer_len);
        if (!append_ok) {
            free(buffer.ptr);
            skill_set_error(err, err_len,
                            "SKILL_PROMPT_RENDER_FAILED: allocation failed");
            return false;
        }
    }
    if (!buffer.ptr) {
        buffer.ptr = malloc(1);
        if (!buffer.ptr) {
            skill_set_error(err, err_len,
                            "SKILL_PROMPT_RENDER_FAILED: allocation failed");
            return false;
        }
        buffer.ptr[0] = '\0';
    }
    *text_out = buffer.ptr;
    *bytes_out = buffer.len;
    if (err && err_len) err[0] = '\0';
    return true;
}

static bool skill_revision_valid(const char *revision) {
    if (!revision ||
        strlen(revision) != DS4_AGENT_SKILL_REVISION_HEX)
        return false;
    for (size_t i = 0; i < DS4_AGENT_SKILL_REVISION_HEX; i++) {
        char c = revision[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
            return false;
    }
    return true;
}

/* Exhaustive on purpose: the old range check (`kind <= ..._SAGE_POLICY`)
 * silently rejected DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY, so every session
 * carrying the Lean policy failed to serialize with "invalid manifest item".
 * A range check would also auto-accept any future kind the rest of the
 * lifecycle does not handle; a switch forces the author to visit this list. */
static bool skill_manifest_kind_valid(ds4_agent_skill_kind kind) {
    switch (kind) {
    case DS4_AGENT_SKILL_DYNAMIC:
    case DS4_AGENT_SKILL_BUILTIN_METACOGNITION:
    case DS4_AGENT_SKILL_BUILTIN_SOUL:
    case DS4_AGENT_SKILL_BUILTIN_ETHIC:
    case DS4_AGENT_SKILL_BUILTIN_STRUCTURE:
    case DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY:
    case DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY:
        return true;
    default:
        return false;
    }
}

static bool skill_manifest_revise(ds4_agent_skill_manifest *manifest) {
    skill_buffer canonical = {0};
    static const char magic[] = "DS4_AGENT_SKILLS_V1";
    if (!skill_buffer_append(&canonical, magic, sizeof(magic)))
        return false;
    for (size_t i = 0; i < manifest->len; i++) {
        const ds4_agent_skill_manifest_item *item = &manifest->items[i];
        const char *kind = ds4_agent_skill_kind_name(item->kind);
        char bytes[32];
        int bytes_len = snprintf(bytes, sizeof(bytes), "%zu",
                                 item->content_len);
        bool ok = bytes_len > 0 && (size_t)bytes_len < sizeof(bytes) &&
            skill_buffer_append(&canonical, item->name,
                                strlen(item->name) + 1) &&
            skill_buffer_append(&canonical, kind, strlen(kind) + 1) &&
            skill_buffer_append(&canonical, item->revision,
                                strlen(item->revision) + 1) &&
            skill_buffer_append(&canonical, bytes,
                                (size_t)bytes_len + 1);
        if (!ok) {
            free(canonical.ptr);
            return false;
        }
    }
    ds4_kvstore_sha1_bytes_hex(canonical.ptr ? canonical.ptr : "",
                               canonical.len,
                               manifest->aggregate_revision);
    free(canonical.ptr);
    return true;
}

void ds4_agent_skill_manifest_init(ds4_agent_skill_manifest *manifest) {
    if (!manifest) return;
    memset(manifest, 0, sizeof(*manifest));
    (void)skill_manifest_revise(manifest);
}

bool ds4_agent_skill_manifest_add(
    ds4_agent_skill_manifest *manifest,
    const char *name,
    ds4_agent_skill_kind kind,
    const char revision[DS4_AGENT_SKILL_REVISION_HEX + 1],
    size_t content_len,
    char *err,
    size_t err_len) {
    if (!manifest || !skill_manifest_kind_valid(kind)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid manifest item");
        return false;
    }
    if (!ds4_agent_skill_name_valid(name, err, err_len))
        return false;
    if (!skill_revision_valid(revision)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid skill revision");
        return false;
    }
    if (content_len == 0 || content_len > DS4_AGENT_SKILL_FILE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid skill byte count");
        return false;
    }
    if (manifest->len >= DS4_AGENT_SKILL_ACTIVE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_ACTIVE_LIMIT: at most 32 skills may be active");
        return false;
    }

    size_t total = content_len;
    size_t pos = 0;
    while (pos < manifest->len &&
           strcmp(manifest->items[pos].name, name) < 0) {
        if (manifest->items[pos].content_len >
            DS4_AGENT_SKILL_TOTAL_MAX - total) {
            skill_set_error(
                err, err_len,
                "SKILL_TOTAL_TOO_LARGE: active skills exceed 1 MiB");
            return false;
        }
        total += manifest->items[pos].content_len;
        pos++;
    }
    if (pos < manifest->len &&
        !strcmp(manifest->items[pos].name, name)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: duplicate skill name");
        return false;
    }
    for (size_t i = pos; i < manifest->len; i++) {
        if (manifest->items[i].content_len >
            DS4_AGENT_SKILL_TOTAL_MAX - total) {
            skill_set_error(
                err, err_len,
                "SKILL_TOTAL_TOO_LARGE: active skills exceed 1 MiB");
            return false;
        }
        total += manifest->items[i].content_len;
    }

    memmove(&manifest->items[pos + 1], &manifest->items[pos],
            (manifest->len - pos) * sizeof(manifest->items[0]));
    ds4_agent_skill_manifest_item *item = &manifest->items[pos];
    memset(item, 0, sizeof(*item));
    memcpy(item->name, name, strlen(name) + 1);
    item->kind = kind;
    memcpy(item->revision, revision,
           DS4_AGENT_SKILL_REVISION_HEX + 1);
    item->content_len = content_len;
    manifest->len++;
    if (!skill_manifest_revise(manifest)) {
        memmove(&manifest->items[pos], &manifest->items[pos + 1],
                (manifest->len - pos - 1) * sizeof(manifest->items[0]));
        manifest->len--;
        memset(&manifest->items[manifest->len], 0,
               sizeof(manifest->items[0]));
        (void)skill_manifest_revise(manifest);
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: allocation failed");
        return false;
    }
    if (err && err_len) err[0] = '\0';
    return true;
}

static char *skill_manifest_path(const char *cache_dir,
                                 const char *sha,
                                 const char *suffix,
                                 char *err,
                                 size_t err_len) {
    if (!cache_dir || !cache_dir[0] || !skill_revision_valid(sha)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid manifest path");
        return NULL;
    }
    size_t dir_len = strlen(cache_dir);
    size_t suffix_len = strlen(suffix);
    if (dir_len > SIZE_MAX - DS4_AGENT_SKILL_REVISION_HEX -
                      suffix_len - 2) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: manifest path too long");
        return NULL;
    }
    size_t len = dir_len + 1 + DS4_AGENT_SKILL_REVISION_HEX + suffix_len;
    char *path = malloc(len + 1);
    if (!path) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: allocation failed");
        return NULL;
    }
    snprintf(path, len + 1, "%s/%s%s", cache_dir, sha, suffix);
    return path;
}

static bool skill_manifest_normalize(
    const ds4_agent_skill_manifest *manifest,
    ds4_agent_skill_manifest *normalized,
    char *err,
    size_t err_len) {
    if (!manifest || manifest->len > DS4_AGENT_SKILL_ACTIVE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid manifest");
        return false;
    }
    ds4_agent_skill_manifest_init(normalized);
    for (size_t i = 0; i < manifest->len; i++) {
        const ds4_agent_skill_manifest_item *item = &manifest->items[i];
        if (!ds4_agent_skill_manifest_add(
                normalized, item->name, item->kind, item->revision,
                item->content_len, err, err_len))
            return false;
        if (strcmp(normalized->items[i].name, item->name)) {
            skill_set_error(err, err_len,
                            "SKILL_MANIFEST_IO_FAILED: skills are not sorted");
            return false;
        }
    }
    if (strcmp(normalized->aggregate_revision,
               manifest->aggregate_revision)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: aggregate revision mismatch");
        return false;
    }
    return true;
}

static bool skill_manifest_render(
    const ds4_agent_skill_manifest *manifest,
    char **text_out,
    size_t *bytes_out,
    char *err,
    size_t err_len) {
    ds4_agent_skill_manifest normalized;
    if (!skill_manifest_normalize(manifest, &normalized, err, err_len))
        return false;

    skill_buffer buffer = {0};
    char header[160];
    int header_len = snprintf(
        header, sizeof(header),
        "DS4_AGENT_SKILLS_V1\naggregate_revision %s\ncount %zu\n",
        manifest->aggregate_revision, manifest->len);
    if (header_len <= 0 || (size_t)header_len >= sizeof(header) ||
        !skill_buffer_append(&buffer, header, (size_t)header_len)) {
        free(buffer.ptr);
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: allocation failed");
        return false;
    }
    for (size_t i = 0; i < manifest->len; i++) {
        const ds4_agent_skill_manifest_item *item = &manifest->items[i];
        char line[256];
        int line_len = snprintf(
            line, sizeof(line), "skill %s %s %s %zu\n",
            item->name, ds4_agent_skill_kind_name(item->kind),
            item->revision, item->content_len);
        if (line_len <= 0 || (size_t)line_len >= sizeof(line) ||
            !skill_buffer_append(&buffer, line, (size_t)line_len)) {
            free(buffer.ptr);
            skill_set_error(err, err_len,
                            "SKILL_MANIFEST_IO_FAILED: allocation failed");
            return false;
        }
    }
    if (buffer.len > DS4_AGENT_SKILL_MANIFEST_MAX) {
        free(buffer.ptr);
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: manifest exceeds 64 KiB");
        return false;
    }
    *text_out = buffer.ptr;
    *bytes_out = buffer.len;
    return true;
}

bool ds4_agent_skill_manifest_stage_write(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    const ds4_agent_skill_manifest *manifest,
    char **temp_path_out,
    char *err,
    size_t err_len) {
    if (!temp_path_out) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: output path is missing");
        return false;
    }
    *temp_path_out = NULL;
    char *final_path = skill_manifest_path(
        cache_dir, sha, ".skills", err, err_len);
    if (!final_path) return false;

    char *text = NULL;
    size_t text_len = 0;
    if (!skill_manifest_render(manifest, &text, &text_len, err, err_len)) {
        free(final_path);
        return false;
    }

    size_t final_len = strlen(final_path);
    static const char temp_suffix[] = ".tmp.XXXXXX";
    char *temp_path = malloc(final_len + sizeof(temp_suffix));
    if (!temp_path) {
        free(text);
        free(final_path);
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: allocation failed");
        return false;
    }
    memcpy(temp_path, final_path, final_len);
    memcpy(temp_path + final_len, temp_suffix, sizeof(temp_suffix));

    int fd = mkstemp(temp_path);
    bool ok = fd >= 0;
    int saved_errno = ok ? 0 : errno;
    size_t written = 0;
    while (ok && written < text_len) {
        ssize_t n = write(fd, text + written, text_len - written);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            saved_errno = n < 0 ? errno : EIO;
            ok = false;
            break;
        }
        written += (size_t)n;
    }
    if (ok && fsync(fd) != 0) {
        saved_errno = errno;
        ok = false;
    }
    if (fd >= 0) {
        if (close(fd) != 0 && ok) {
            saved_errno = errno;
            ok = false;
        }
        fd = -1;
    }
    if (!ok) {
        unlink(temp_path);
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(saved_errno ? saved_errno : EIO));
        free(temp_path);
    } else {
        *temp_path_out = temp_path;
        if (err && err_len) err[0] = '\0';
    }
    free(text);
    free(final_path);
    return ok;
}

bool ds4_agent_skill_manifest_commit(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    char **temp_path,
    char *err,
    size_t err_len) {
    if (!temp_path || !*temp_path) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: staged manifest is missing");
        return false;
    }
    char *final_path = skill_manifest_path(
        cache_dir, sha, ".skills", err, err_len);
    if (!final_path) return false;
    if (rename(*temp_path, final_path) != 0) {
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(errno));
        free(final_path);
        return false;
    }
    free(*temp_path);
    *temp_path = NULL;

    int dir_fd = open(cache_dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir_fd < 0 || fsync(dir_fd) != 0) {
        int saved_errno = errno;
        if (dir_fd >= 0) close(dir_fd);
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(saved_errno));
        free(final_path);
        return false;
    }
    close(dir_fd);
    free(final_path);
    if (err && err_len) err[0] = '\0';
    return true;
}

void ds4_agent_skill_manifest_abort(char **temp_path) {
    if (!temp_path || !*temp_path) return;
    unlink(*temp_path);
    free(*temp_path);
    *temp_path = NULL;
}

static bool skill_parse_size(const char *text, size_t *value) {
    if (!text || !text[0]) return false;
    size_t parsed = 0;
    for (const char *p = text; *p; p++) {
        if (*p < '0' || *p > '9') return false;
        unsigned digit = (unsigned)(*p - '0');
        if (parsed > (SIZE_MAX - digit) / 10) return false;
        parsed = parsed * 10 + digit;
    }
    *value = parsed;
    return true;
}

static char *skill_manifest_line(char **cursor, char *end) {
    if (*cursor >= end) return NULL;
    char *line = *cursor;
    char *newline = memchr(line, '\n', (size_t)(end - line));
    if (!newline) return NULL;
    *newline = '\0';
    *cursor = newline + 1;
    return line;
}

static bool skill_manifest_parse(char *text,
                                 size_t text_len,
                                 ds4_agent_skill_manifest *manifest,
                                 char *err,
                                 size_t err_len) {
    if (!text_len || text[text_len - 1] != '\n' ||
        memchr(text, '\r', text_len) ||
        memchr(text, '\0', text_len)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: malformed manifest text");
        return false;
    }
    char *cursor = text;
    char *end = text + text_len;
    char *line = skill_manifest_line(&cursor, end);
    if (!line || strcmp(line, "DS4_AGENT_SKILLS_V1")) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid manifest magic");
        return false;
    }

    static const char aggregate_prefix[] = "aggregate_revision ";
    line = skill_manifest_line(&cursor, end);
    if (!line || strncmp(line, aggregate_prefix,
                         sizeof(aggregate_prefix) - 1)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: missing aggregate revision");
        return false;
    }
    const char *expected_revision = line + sizeof(aggregate_prefix) - 1;
    if (!skill_revision_valid(expected_revision)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid aggregate revision");
        return false;
    }
    char expected[DS4_AGENT_SKILL_REVISION_HEX + 1];
    memcpy(expected, expected_revision, sizeof(expected));

    static const char count_prefix[] = "count ";
    line = skill_manifest_line(&cursor, end);
    size_t count = 0;
    if (!line || strncmp(line, count_prefix, sizeof(count_prefix) - 1) ||
        !skill_parse_size(line + sizeof(count_prefix) - 1, &count) ||
        count > DS4_AGENT_SKILL_ACTIVE_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid skill count");
        return false;
    }

    ds4_agent_skill_manifest parsed;
    ds4_agent_skill_manifest_init(&parsed);
    char previous[DS4_AGENT_SKILL_NAME_MAX + 1] = {0};
    for (size_t i = 0; i < count; i++) {
        line = skill_manifest_line(&cursor, end);
        if (!line || strncmp(line, "skill ", 6)) {
            skill_set_error(err, err_len,
                            "SKILL_MANIFEST_IO_FAILED: invalid skill row");
            return false;
        }
        char *name = line + 6;
        char *kind_text = strchr(name, ' ');
        if (!kind_text || kind_text == name) goto malformed_row;
        *kind_text++ = '\0';
        char *revision = strchr(kind_text, ' ');
        if (!revision || revision == kind_text) goto malformed_row;
        *revision++ = '\0';
        char *bytes = strchr(revision, ' ');
        if (!bytes || bytes == revision) goto malformed_row;
        *bytes++ = '\0';
        if (!bytes[0] || strchr(bytes, ' ') || strchr(line, '\t'))
            goto malformed_row;

        ds4_agent_skill_kind kind;
        if (!strcmp(kind_text, "dynamic"))
            kind = DS4_AGENT_SKILL_DYNAMIC;
        else if (!strcmp(kind_text, "builtin"))
            kind = DS4_AGENT_SKILL_BUILTIN_METACOGNITION;
        else
            goto malformed_row;
        size_t content_len = 0;
        if (!skill_parse_size(bytes, &content_len))
            goto malformed_row;
        if (previous[0] && strcmp(previous, name) >= 0)
            goto malformed_row;
        if (!ds4_agent_skill_manifest_add(
                &parsed, name, kind, revision, content_len,
                err, err_len))
            return false;
        memcpy(previous, name, strlen(name) + 1);
        continue;

malformed_row:
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid skill row");
        return false;
    }
    if (cursor != end) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: trailing manifest data");
        return false;
    }
    if (strcmp(parsed.aggregate_revision, expected)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: aggregate revision mismatch");
        return false;
    }
    *manifest = parsed;
    return true;
}

bool ds4_agent_skill_manifest_read(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    ds4_agent_skill_manifest *manifest,
    bool *found,
    char *err,
    size_t err_len) {
    if (!manifest || !found) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid read output");
        return false;
    }
    ds4_agent_skill_manifest_init(manifest);
    *found = false;
    char *path = skill_manifest_path(
        cache_dir, sha, ".skills", err, err_len);
    if (!path) return false;

    struct stat before;
    struct stat after;
    if (lstat(path, &before) != 0) {
        if (errno == ENOENT) {
            free(path);
            if (err && err_len) err[0] = '\0';
            return true;
        }
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(errno));
        free(path);
        return false;
    }
    if (!S_ISREG(before.st_mode) || S_ISLNK(before.st_mode) ||
        before.st_size <= 0 ||
        (uintmax_t)before.st_size > DS4_AGENT_SKILL_MANIFEST_MAX) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: invalid manifest file");
        free(path);
        return false;
    }

    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0 || fstat(fd, &before) != 0) {
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(errno));
        if (fd >= 0) close(fd);
        free(path);
        return false;
    }
    size_t len = (size_t)before.st_size;
    char *text = malloc(len + 1);
    if (!text) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: allocation failed");
        close(fd);
        free(path);
        return false;
    }
    size_t used = 0;
    bool ok = true;
    while (used < len) {
        ssize_t n = read(fd, text + used, len - used);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            ok = false;
            break;
        }
        used += (size_t)n;
    }
    if (!ok || fstat(fd, &after) != 0 ||
        !skill_stat_unchanged(&before, &after)) {
        skill_set_error(err, err_len,
                        "SKILL_MANIFEST_IO_FAILED: manifest changed while reading");
        close(fd);
        free(text);
        free(path);
        return false;
    }
    close(fd);
    free(path);
    text[len] = '\0';
    if (!skill_manifest_parse(text, len, manifest, err, err_len)) {
        free(text);
        return false;
    }
    free(text);
    *found = true;
    if (err && err_len) err[0] = '\0';
    return true;
}

bool ds4_agent_skill_manifest_remove(
    const char *cache_dir,
    const char sha[DS4_AGENT_SKILL_REVISION_HEX + 1],
    bool *removed,
    char *err,
    size_t err_len) {
    if (removed) *removed = false;
    char *path = skill_manifest_path(
        cache_dir, sha, ".skills", err, err_len);
    if (!path) return false;
    if (unlink(path) != 0) {
        if (errno == ENOENT) {
            free(path);
            if (err && err_len) err[0] = '\0';
            return true;
        }
        skill_set_error(err, err_len, "SKILL_MANIFEST_IO_FAILED: %s",
                        strerror(errno));
        free(path);
        return false;
    }
    free(path);
    if (removed) *removed = true;
    if (err && err_len) err[0] = '\0';
    return true;
}

const char *ds4_agent_skill_kind_name(ds4_agent_skill_kind kind) {
    switch (kind) {
    case DS4_AGENT_SKILL_DYNAMIC: return "dynamic";
    case DS4_AGENT_SKILL_BUILTIN_METACOGNITION: return "builtin";
    case DS4_AGENT_SKILL_BUILTIN_SOUL: return "builtin";
    case DS4_AGENT_SKILL_BUILTIN_ETHIC: return "builtin";
    case DS4_AGENT_SKILL_BUILTIN_STRUCTURE: return "builtin";
    case DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY: return "builtin";
    case DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY: return "builtin";
    default: return "unknown";
    }
}
