#include "ds4_agent_session_store.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <errno.h>
#include <sys/stat.h>
#include <limits.h>

/* Allocates memory and aborts on failure like xmalloc in other modules */
static void *store_xmalloc(size_t n) {
    void *p = malloc(n);
    if (!p) {
        fprintf(stderr, "Out of memory allocating %zu bytes\n", n);
        abort();
    }
    return p;
}

static char *store_xstrdup(const char *s) {
    if (!s) return NULL;
    size_t len = strlen(s);
    char *p = store_xmalloc(len + 1);
    memcpy(p, s, len + 1);
    return p;
}

static void store_le_put64(uint8_t *p, uint64_t v) {
    for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i));
}

bool ds4_sess_store_ram(ds4_session *session,
                        ds4_session_snapshot *snap,
                        char *err,
                        size_t err_len) {
    if (!session || !snap) {
        snprintf(err, err_len, "invalid session or snapshot");
        return false;
    }
    return ds4_session_save_snapshot(session, snap, err, err_len) == 0;
}

bool ds4_sess_load_ram(ds4_session *session,
                       const ds4_session_snapshot *snap,
                       char *err,
                       size_t err_len) {
    if (!session || !snap || !snap->ptr || snap->len == 0) {
        snprintf(err, err_len, "invalid RAM snapshot");
        return false;
    }
    return ds4_session_load_snapshot(session, snap, err, err_len) == 0;
}

bool ds4_sess_disk_exists(const char *path) {
    return access(path, F_OK) == 0;
}

bool ds4_agent_kv_read_text(FILE *fp, uint32_t text_bytes,
                            char **text_out, char *err, size_t err_len) {
    char *text = store_xmalloc((size_t)text_bytes + 1);
    if (fread(text, 1, text_bytes, fp) != text_bytes) {
        if (err && err_len) snprintf(err, err_len, "truncated cached text");
        free(text);
        return false;
    }
    text[text_bytes] = '\0';
    *text_out = text;
    return true;
}

bool ds4_agent_kv_write_title_trailer(FILE *fp, const char *title,
                                      char *err, size_t err_len) {
    size_t title_len = title ? strlen(title) : 0;
    if (title_len > UINT32_MAX) {
        snprintf(err, err_len, "agent session title is too large");
        return false;
    }
    uint8_t tb[4];
    ds4_kvstore_le_put32(tb, (uint32_t)title_len);
    return fwrite(tb, 1, sizeof(tb), fp) == sizeof(tb) &&
           fwrite(title ? title : "", 1, title_len, fp) == title_len;
}

bool ds4_agent_kv_read_title_trailer(FILE *fp, const ds4_kvstore_entry *hdr,
                                     char **title_out,
                                     char *err, size_t err_len) {
    off_t payload_pos = ftello(fp);
    if (payload_pos < 0) {
        if (err && err_len) snprintf(err, err_len, "%s", strerror(errno));
        return false;
    }
    if (hdr->payload_bytes > (uint64_t)LLONG_MAX ||
        fseeko(fp, (off_t)hdr->payload_bytes, SEEK_CUR) != 0)
    {
        if (err && err_len) snprintf(err, err_len, "%s", strerror(errno));
        return false;
    }

    uint8_t tb[4];
    if (fread(tb, 1, sizeof(tb), fp) != sizeof(tb)) {
        if (err && err_len) snprintf(err, err_len, "missing agent session title trailer");
        fseeko(fp, payload_pos, SEEK_SET);
        return false;
    }
    uint32_t title_bytes = ds4_kvstore_le_get32(tb);
    char *title = store_xmalloc((size_t)title_bytes + 1);
    if (fread(title, 1, title_bytes, fp) != title_bytes) {
        if (err && err_len) snprintf(err, err_len, "truncated agent session title trailer");
        free(title);
        fseeko(fp, payload_pos, SEEK_SET);
        return false;
    }
    title[title_bytes] = '\0';
    if (fseeko(fp, payload_pos, SEEK_SET) != 0) {
        if (err && err_len) snprintf(err, err_len, "%s", strerror(errno));
        free(title);
        return false;
    }
    *title_out = title;
    return true;
}

void ds4_agent_session_identity_sha(const char *title, uint64_t created_at,
                                    char sha_out[41]) {
    size_t title_len = title ? strlen(title) : 0;
    
    // Manual buffer accumulation to avoid external dependencies
    size_t total_len = title_len + 8;
    char *buf = store_xmalloc(total_len ? total_len : 1);
    if (title_len) memcpy(buf, title, title_len);
    
    uint8_t ts[8];
    store_le_put64(ts, created_at);
    memcpy(buf + title_len, ts, 8);
    
    ds4_kvstore_sha1_bytes_hex(buf, total_len, sha_out);
    free(buf);
}

void ds4_agent_kv_identity_sha(const ds4_kvstore_entry *hdr,
                               const char *text, uint32_t text_bytes,
                               const char *title,
                               char sha_out[41]) {
    if (hdr->ext_flags & DS4_KVSTORE_EXT_SESSION_TITLE) {
        ds4_agent_session_identity_sha(title ? title : "", hdr->created_at, sha_out);
    } else {
        ds4_kvstore_sha1_bytes_hex(text, text_bytes, sha_out);
    }
}

bool ds4_sess_store_disk(ds4_engine *engine,
                         ds4_session *session,
                         const ds4_tokens *tokens,
                         const char *path,
                         const char *title,
                         uint64_t created_at,
                         char *err,
                         size_t err_len) {
    const ds4_tokens *live = ds4_session_tokens(session);
    if (!live) {
        snprintf(err, err_len, "live KV state is not initialized");
        return false;
    }
    // Verify tokens match live session tokens if tokens is provided
    if (tokens) {
        if (live->len != tokens->len) {
            snprintf(err, err_len, "live KV state does not match session transcript");
            return false;
        }
        for (int i = 0; i < live->len; i++) {
            if (live->v[i] != tokens->v[i]) {
                snprintf(err, err_len, "live KV state does not match session transcript");
                return false;
            }
        }
    } else {
        tokens = live;
    }

    const int quant_bits = ds4_engine_routed_quant_bits(engine);
    if (quant_bits != 2 && quant_bits != 4) {
        snprintf(err, err_len, "unsupported routed quantization for KV save");
        return false;
    }
    const int model_id = ds4_engine_model_id(engine);

    size_t text_len = 0;
    char *text = ds4_kvstore_render_tokens_text(engine, tokens, &text_len);
    if (!text) {
        snprintf(err, err_len, "failed to render KV text key");
        return false;
    }
    if (text_len > UINT32_MAX) {
        snprintf(err, err_len, "rendered KV text key is too large");
        free(text);
        return false;
    }

    const bool session_identity = (title != NULL);
    uint64_t now = (uint64_t)time(NULL);
    uint64_t real_created_at = (session_identity && created_at) ? created_at : now;

    uint64_t payload_bytes = ds4_session_payload_bytes(session);
    if (payload_bytes == 0) {
        snprintf(err, err_len, "session has no valid KV payload");
        free(text);
        return false;
    }

    size_t path_len = strlen(path);
    char *tmp = store_xmalloc(path_len + 12);
    memcpy(tmp, path, path_len);
    memcpy(tmp + path_len, ".tmp.XXXXXX", 12);

    int fd = mkstemp(tmp);
    if (fd < 0) {
        snprintf(err, err_len, "mkstemp failed: %s", strerror(errno));
        free(tmp);
        free(text);
        return false;
    }

    FILE *fp = fdopen(fd, "wb");
    if (!fp) {
        snprintf(err, err_len, "fdopen failed: %s", strerror(errno));
        close(fd);
        unlink(tmp);
        free(tmp);
        free(text);
        return false;
    }

    uint8_t h[DS4_KVSTORE_FIXED_HEADER];
    ds4_kvstore_fill_header(h, (uint8_t)model_id, (uint8_t)quant_bits,
                            ds4_kvstore_reason_code(session_identity ? "agent_session" : "agent_system"),
                            session_identity ? DS4_KVSTORE_EXT_SESSION_TITLE : 0,
                            (uint32_t)tokens->len, 0,
                            (uint32_t)ds4_session_ctx(session),
                            real_created_at, now, payload_bytes);
    uint8_t tb[4];
    ds4_kvstore_le_put32(tb, (uint32_t)text_len);

    char save_err[160] = {0};
    errno = 0;
    bool ok = fwrite(h, 1, sizeof(h), fp) == sizeof(h) &&
              fwrite(tb, 1, sizeof(tb), fp) == sizeof(tb) &&
              fwrite(text, 1, text_len, fp) == text_len &&
              ds4_session_save_payload(session, fp, save_err, sizeof(save_err)) == 0 &&
              (!session_identity ||
               ds4_agent_kv_write_title_trailer(fp, title, save_err, sizeof(save_err))) &&
              fflush(fp) == 0;
    int saved_errno = errno;
    if (fclose(fp) != 0) {
        if (!saved_errno) saved_errno = errno;
        ok = false;
    }
    if (ok && rename(tmp, path) != 0) {
        saved_errno = errno;
        ok = false;
    }
    if (!ok) {
        snprintf(err, err_len, "%s",
                 saved_errno ? strerror(saved_errno) :
                 (save_err[0] ? save_err : "failed to write KV file"));
        unlink(tmp);
    }

    free(tmp);
    free(text);
    return ok;
}

bool ds4_sess_load_disk(ds4_engine *engine,
                        ds4_session *session,
                        const char *path,
                        ds4_tokens *out_tokens,
                        ds4_kvstore_load_result *result,
                        char *err,
                        size_t err_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        snprintf(err, err_len, "%s", strerror(errno));
        return false;
    }

    ds4_kvstore_entry hdr = {0};
    uint32_t text_bytes = 0;
    bool ok = ds4_kvstore_read_header(fp, &hdr, &text_bytes);
    if (!ok) {
        snprintf(err, err_len, "invalid KV header");
        fclose(fp);
        return false;
    }

    char *text = NULL;
    ok = ds4_agent_kv_read_text(fp, text_bytes, &text, err, err_len);
    if (!ok) {
        fclose(fp);
        return false;
    }

    char *title = NULL;
    bool has_title = (hdr.ext_flags & DS4_KVSTORE_EXT_SESSION_TITLE);
    if (has_title) {
        ok = ds4_agent_kv_read_title_trailer(fp, &hdr, &title, err, err_len);
        if (!ok) {
            free(text);
            fclose(fp);
            return false;
        }
    }

    if (hdr.payload_bytes != 0 &&
        hdr.model_id != (uint8_t)ds4_engine_model_id(engine))
    {
        snprintf(err, err_len, "KV checkpoint was written for a different model");
        ok = false;
    }
    if (ok && hdr.payload_bytes != 0 &&
        hdr.quant_bits != (uint8_t)ds4_engine_routed_quant_bits(engine))
    {
        snprintf(err, err_len, "KV checkpoint was written for a different quantization");
        ok = false;
    }

    char load_err[160] = {0};
    if (ok) {
        if (hdr.payload_bytes == 0) {
            ds4_tokens rebuilt = {0};
            ds4_tokenize_rendered_chat(engine, text, &rebuilt);
            if (ds4_session_sync(session, &rebuilt, load_err, sizeof(load_err)) != 0) {
                snprintf(err, err_len, "%s", load_err[0] ? load_err : "failed to sync rebuilt tokens");
                ds4_session_invalidate(session);
                ok = false;
            } else if (out_tokens) {
                ds4_tokens_copy(out_tokens, &rebuilt);
            }
            ds4_tokens_free(&rebuilt);
        } else {
            if (ds4_session_load_payload(session, fp, hdr.payload_bytes, load_err, sizeof(load_err)) != 0) {
                snprintf(err, err_len, "%s", load_err[0] ? load_err : "failed to load KV payload");
                ds4_session_invalidate(session);
                ok = false;
            } else if (out_tokens) {
                const ds4_tokens *live = ds4_session_tokens(session);
                if (!live || live->len != (int)hdr.tokens) {
                    snprintf(err, err_len, "KV payload token count mismatch");
                    ds4_session_invalidate(session);
                    ok = false;
                } else {
                    ds4_tokens_copy(out_tokens, live);
                }
            }
        }
    }

    fclose(fp);

    if (ok && result) {
        result->tokens = hdr.tokens;
        result->text_bytes = text_bytes;
        result->quant_bits = hdr.quant_bits;
        result->ext_flags = hdr.ext_flags;
        result->load_ms = 0.0;
        result->consumed = true;
        result->path = store_xstrdup(path);
    }

    free(title);
    free(text);
    return ok;
}
