#include "buf.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

// Default error handler — prints to stderr and exits. Callers can override by
// setting g_dynbuf_error before using any DynBuf in their translation unit.
static void dynbuf_error_default(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    exit(1);
}

buf_error_fn g_dynbuf_error = dynbuf_error_default;

void dynbuf_reserve(DynBuf *b, size_t add) {
    buf_error_fn err = g_dynbuf_error;
    if (add > SIZE_MAX - b->len - 1) err("buffer overflow");
    size_t need = b->len + add + 1;
    if (need <= b->cap) return;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < need) {
        if (cap > SIZE_MAX / 2) err("buffer overflow");
        cap *= 2;
    }
    char *p = realloc(b->ptr, cap);
    if (!p) err("out of memory");
    b->ptr = p;
    b->cap = cap;
}

void dynbuf_append(DynBuf *b, const void *p, size_t n) {
    dynbuf_reserve(b, n);
    memcpy(b->ptr + b->len, p, n);
    b->len += n;
    b->ptr[b->len] = '\0';
}

void dynbuf_putc(DynBuf *b, char c) {
    dynbuf_append(b, &c, 1);
}

void dynbuf_puts(DynBuf *b, const char *s) {
    dynbuf_append(b, s, strlen(s));
}

// No per-buffer init needed — use g_dynbuf_error global instead.

void dynbuf_printf(DynBuf *b, const char *fmt, ...) {
    buf_error_fn err = g_dynbuf_error;
    va_list ap;
    va_start(ap, fmt);
    va_list ap2;
    va_copy(ap2, ap);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) err("vsnprintf failed");
    dynbuf_reserve(b, (size_t)n);
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap2);
    va_end(ap2);
    b->len += (size_t)n;
}
