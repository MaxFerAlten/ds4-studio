// Non-regression test for the shared DynBuf API (buf.h / buf.c).
// Exercises reserve, append, putc, puts, printf, and edge cases.
// Build: cc -O3 -g -Wall -Wextra -std=c99 -D_GNU_SOURCE -o test_buf test_buf.c buf.c

#include "../buf.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    // 1. Basic append + puts
    DynBuf b = {0};
    dynbuf_puts(&b, "hello");
    assert(b.len == 5);
    assert(strcmp(b.ptr, "hello") == 0);
    assert(b.cap >= 5);

    // 2. Append more
    dynbuf_append(&b, " world", 6);
    assert(b.len == 11);
    assert(strcmp(b.ptr, "hello world") == 0);

    // 3. Single char append
    dynbuf_putc(&b, '!');
    assert(b.len == 12);
    assert(strcmp(b.ptr, "hello world!") == 0);

    // 4. printf
    dynbuf_printf(&b, " %d + %d = %d", 2, 3, 5);
    assert(b.len == 22);
    assert(strcmp(b.ptr, "hello world! 2 + 3 = 5") == 0);

    // 5. Empty buffer (no crash)
    DynBuf empty = {0};
    dynbuf_puts(&empty, "");
    assert(empty.len == 0);
    assert(empty.ptr != NULL);
    assert(strcmp(empty.ptr, "") == 0);
    free(empty.ptr);

    // 6. Large append (forces growth)
    DynBuf big = {0};
    char bigbuf[4096];
    memset(bigbuf, 'A', sizeof(bigbuf));
    bigbuf[4095] = '\0';
    dynbuf_append(&big, bigbuf, sizeof(bigbuf) - 1);
    assert(big.len == 4095);
    assert(big.ptr[0] == 'A');
    assert(big.ptr[4094] == 'A');
    assert(big.ptr[4095] == '\0');
    free(big.ptr);

    // 7. Multiple appends (growth chain)
    DynBuf chain = {0};
    for (int i = 0; i < 100; i++) {
        char chunk[] = "0123456789";
        dynbuf_append(&chain, chunk, strlen(chunk));
    }
    assert(chain.len == 1000);
    assert(chain.ptr[0] == '0');
    assert(chain.ptr[999] == '9');
    free(chain.ptr);

    // 8. Printf edge: empty format
    DynBuf fmt = {0};
    dynbuf_printf(&fmt, "");
    assert(fmt.len == 0);
    free(fmt.ptr);

    // 9. Printf with integers
    DynBuf fmt2 = {0};
    dynbuf_printf(&fmt2, "%s has %d items", "list", 42);
    assert(fmt2.len == 17);
    assert(strcmp(fmt2.ptr, "list has 42 items") == 0);
    free(fmt2.ptr);

    // 10. Putc on empty buffer
    DynBuf pc = {0};
    dynbuf_putc(&pc, 'x');
    assert(pc.len == 1);
    assert(pc.ptr[0] == 'x');
    free(pc.ptr);

    printf("test_buf: all %d assertions passed\n", 10);
    return 0;
}
