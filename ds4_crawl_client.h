#ifndef DS4_CRAWL_CLIENT_H
#define DS4_CRAWL_CLIENT_H

#include <stddef.h>

int ds4_crawl_client_read_token(char *token, size_t token_len,
                                char *err, size_t err_len);

int ds4_crawl_client_build_url_body(const char *url, char *out,
                                    size_t out_len, char *err,
                                    size_t err_len);

int ds4_crawl_client_request(const char *method, const char *path,
                             const char *body, int timeout_sec,
                             char *out, size_t out_len,
                             char *err, size_t err_len);

int ds4_crawl_client_get(const char *path, char *out, size_t out_len,
                         char *err, size_t err_len);

int ds4_crawl_client_post(const char *path, const char *body,
                          char *out, size_t out_len,
                          char *err, size_t err_len);

int ds4_crawl_client_delete(const char *path, char *out, size_t out_len,
                            char *err, size_t err_len);

#endif
