#ifndef DS4_AGENT_SESSION_STORE_H
#define DS4_AGENT_SESSION_STORE_H

#include "ds4.h"
#include "ds4_kvstore.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

bool ds4_sess_store_ram(ds4_session *session,
                        ds4_session_snapshot *snap,
                        char *err,
                        size_t err_len);

bool ds4_sess_load_ram(ds4_session *session,
                       const ds4_session_snapshot *snap,
                       char *err,
                       size_t err_len);

bool ds4_sess_store_disk(ds4_engine *engine,
                         ds4_session *session,
                         const ds4_tokens *tokens,
                         const char *path,
                         const char *title,
                         uint64_t created_at,
                         char *err,
                         size_t err_len);

bool ds4_sess_load_disk(ds4_engine *engine,
                        ds4_session *session,
                        const char *path,
                        ds4_tokens *out_tokens,
                        ds4_kvstore_load_result *result,
                        char *err,
                        size_t err_len);

bool ds4_sess_disk_exists(const char *path);

/* Helper functions extracted from ds4_agent.c for external reuse */
bool ds4_agent_kv_read_text(FILE *fp, uint32_t text_bytes,
                            char **text_out, char *err, size_t err_len);

bool ds4_agent_kv_write_title_trailer(FILE *fp, const char *title,
                                      char *err, size_t err_len);

bool ds4_agent_kv_read_title_trailer(FILE *fp, const ds4_kvstore_entry *hdr,
                                     char **title_out,
                                     char *err, size_t err_len);

void ds4_agent_session_identity_sha(const char *title, uint64_t created_at,
                                    char sha_out[41]);

void ds4_agent_kv_identity_sha(const ds4_kvstore_entry *hdr,
                               const char *text, uint32_t text_bytes,
                               const char *title,
                               char sha_out[41]);

#endif /* DS4_AGENT_SESSION_STORE_H */
