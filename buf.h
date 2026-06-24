// Shared dynamic-buffer API used by ds4_server.c, ds4_eval.c, and ds4_kvstore.c.
// Before: each file had its own buffer (buf, byte_buf, kv_buf) with identical
// reserve-append-printf semantics but different names and error handling.
// Unified here to reduce duplication and make error behavior consistent.
//
// Error handling: callers can set b->on_error to a custom error function.
// If NULL, the default in buf.c prints to stderr and exits.

#ifndef BUF_H
#define BUF_H

#include <stddef.h>
#include <stdint.h>

typedef void (*buf_error_fn)(const char *fmt, ...);

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} DynBuf;

// Global error handler for DynBuf operations. Each translation unit that uses
// DynBuf should set this to its preferred error function at file scope.
// Default in buf.c prints to stderr and exits.
extern buf_error_fn g_dynbuf_error;

// Grow buffer to hold at least `add` more bytes (plus NUL).
void dynbuf_reserve(DynBuf *b, size_t add);

// Append n bytes from p, null-terminate.
void dynbuf_append(DynBuf *b, const void *p, size_t n);

// Append single char.
void dynbuf_putc(DynBuf *b, char c);

// Append null-terminated string.
void dynbuf_puts(DynBuf *b, const char *s);

// Append printf-formatted output (null-terminated).
void dynbuf_printf(DynBuf *b, const char *fmt, ...);

// Initialize a DynBuf with a custom error handler (or NULL for default).
void dynbuf_init(DynBuf *b, buf_error_fn on_error);

#endif
