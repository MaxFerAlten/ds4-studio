#ifndef DS4_OPENWIKI_CLIENT_H
#define DS4_OPENWIKI_CLIENT_H

#include "ds4_openwiki_policy.h"

/* Caller owns *out; functions initialize it to NULL on every error. */
ds4_ow_result ds4_ow_search(const ds4_ow_config *cfg,
                            const char *query,
                            const char *const *paths, size_t paths_len,
                            unsigned limit,
                            ds4_ow_cancel_fn cancelled, void *cancel_ud,
                            char **out, size_t *out_len,
                            char *err, size_t err_len);

ds4_ow_result ds4_ow_read(const ds4_ow_config *cfg,
                          const char *page,
                          const char *const *sections, size_t sections_len,
                          ds4_ow_cancel_fn cancelled, void *cancel_ud,
                          char **out, size_t *out_len,
                          char *err, size_t err_len);

#endif
