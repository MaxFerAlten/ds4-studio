#include "ds4_context_blob.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

/* Small SHA-256 implementation for content-addressed local blobs.  Keeping it
 * here avoids adding an SSL/libcrypto dependency to the tiny C agent path. */
typedef struct {
    uint32_t h[8];
    uint8_t block[64];
    uint64_t bit_len;
    size_t block_len;
} ds4_sha256_ctx;

static uint32_t ds4_sha256_rotr(uint32_t x, uint32_t n) {
    return (x >> n) | (x << (32u - n));
}

static const uint32_t ds4_sha256_k[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static void ds4_sha256_transform(ds4_sha256_ctx *ctx, const uint8_t block[64]) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) {
        w[i] = ((uint32_t)block[i * 4] << 24) |
               ((uint32_t)block[i * 4 + 1] << 16) |
               ((uint32_t)block[i * 4 + 2] << 8) |
               (uint32_t)block[i * 4 + 3];
    }
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = ds4_sha256_rotr(w[i - 15], 7) ^ ds4_sha256_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = ds4_sha256_rotr(w[i - 2], 17) ^ ds4_sha256_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    uint32_t a = ctx->h[0], b = ctx->h[1], c = ctx->h[2], d = ctx->h[3];
    uint32_t e = ctx->h[4], f = ctx->h[5], g = ctx->h[6], h = ctx->h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t s1 = ds4_sha256_rotr(e, 6) ^ ds4_sha256_rotr(e, 11) ^ ds4_sha256_rotr(e, 25);
        uint32_t ch = (e & f) ^ ((~e) & g);
        uint32_t temp1 = h + s1 + ch + ds4_sha256_k[i] + w[i];
        uint32_t s0 = ds4_sha256_rotr(a, 2) ^ ds4_sha256_rotr(a, 13) ^ ds4_sha256_rotr(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temp2 = s0 + maj;
        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    ctx->h[0] += a; ctx->h[1] += b; ctx->h[2] += c; ctx->h[3] += d;
    ctx->h[4] += e; ctx->h[5] += f; ctx->h[6] += g; ctx->h[7] += h;
}

static void ds4_sha256_init(ds4_sha256_ctx *ctx) {
    ctx->h[0] = 0x6a09e667u; ctx->h[1] = 0xbb67ae85u;
    ctx->h[2] = 0x3c6ef372u; ctx->h[3] = 0xa54ff53au;
    ctx->h[4] = 0x510e527fu; ctx->h[5] = 0x9b05688cu;
    ctx->h[6] = 0x1f83d9abu; ctx->h[7] = 0x5be0cd19u;
    ctx->bit_len = 0;
    ctx->block_len = 0;
}

static void ds4_sha256_update(ds4_sha256_ctx *ctx, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        ctx->block[ctx->block_len++] = data[i];
        if (ctx->block_len == sizeof(ctx->block)) {
            ds4_sha256_transform(ctx, ctx->block);
            ctx->bit_len += 512;
            ctx->block_len = 0;
        }
    }
}

static void ds4_sha256_final(ds4_sha256_ctx *ctx, uint8_t out[32]) {
    size_t i = ctx->block_len;
    ctx->block[i++] = 0x80;
    if (i > 56) {
        while (i < 64) ctx->block[i++] = 0;
        ds4_sha256_transform(ctx, ctx->block);
        i = 0;
    }
    while (i < 56) ctx->block[i++] = 0;
    ctx->bit_len += (uint64_t)ctx->block_len * 8u;
    for (int j = 7; j >= 0; j--) {
        ctx->block[i++] = (uint8_t)(ctx->bit_len >> (j * 8));
    }
    ds4_sha256_transform(ctx, ctx->block);
    for (int j = 0; j < 8; j++) {
        out[j * 4] = (uint8_t)(ctx->h[j] >> 24);
        out[j * 4 + 1] = (uint8_t)(ctx->h[j] >> 16);
        out[j * 4 + 2] = (uint8_t)(ctx->h[j] >> 8);
        out[j * 4 + 3] = (uint8_t)ctx->h[j];
    }
}

static void ds4_sha256_hex(const void *data, size_t len, char hex[65]) {
    static const char digits[] = "0123456789abcdef";
    uint8_t digest[32];
    ds4_sha256_ctx ctx;
    ds4_sha256_init(&ctx);
    ds4_sha256_update(&ctx, (const uint8_t *)data, len);
    ds4_sha256_final(&ctx, digest);
    for (int i = 0; i < 32; i++) {
        hex[i * 2] = digits[digest[i] >> 4];
        hex[i * 2 + 1] = digits[digest[i] & 15];
    }
    hex[64] = '\0';
}

static void ds4_blob_set_err(char *err, size_t err_len, const char *msg) {
    if (err && err_len) snprintf(err, err_len, "%s", msg ? msg : "unknown error");
}

static bool ds4_blob_mkdir_p(const char *path, char *err, size_t err_len) {
    if (!path || !path[0]) {
        ds4_blob_set_err(err, err_len, "missing blob directory");
        return false;
    }
    char *tmp = malloc(strlen(path) + 1);
    if (!tmp) {
        ds4_blob_set_err(err, err_len, "out of memory");
        return false;
    }
    strcpy(tmp, path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p != '/') continue;
        *p = '\0';
        if (mkdir(tmp, 0700) != 0 && errno != EEXIST) {
            snprintf(err, err_len, "mkdir %s: %s", tmp, strerror(errno));
            free(tmp);
            return false;
        }
        *p = '/';
    }
    if (mkdir(tmp, 0700) != 0 && errno != EEXIST) {
        snprintf(err, err_len, "mkdir %s: %s", tmp, strerror(errno));
        free(tmp);
        return false;
    }
    free(tmp);
    return true;
}

static bool ds4_blob_join_path(const char *base_dir, const char *hex,
                               char *path, size_t path_len,
                               char *err, size_t err_len) {
    if (!base_dir || !base_dir[0] || !hex || strlen(hex) != 64) {
        ds4_blob_set_err(err, err_len, "invalid blob path input");
        return false;
    }
    int n = snprintf(path, path_len, "%s/sha256/%s.txt", base_dir, hex);
    if (n < 0 || (size_t)n >= path_len) {
        ds4_blob_set_err(err, err_len, "blob path too long");
        return false;
    }
    return true;
}

bool ds4_context_blob_id_valid(const char *id) {
    if (!id || strncmp(id, "sha256:", 7) != 0) return false;
    const char *hex = id + 7;
    if (strlen(hex) != 64) return false;
    for (int i = 0; i < 64; i++) {
        char c = hex[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

static bool ds4_blob_write_all(int fd, const char *p, size_t n,
                               char *err, size_t err_len) {
    while (n) {
        ssize_t wr = write(fd, p, n);
        if (wr < 0 && errno == EINTR) continue;
        if (wr <= 0) {
            snprintf(err, err_len, "write blob: %s", strerror(errno));
            return false;
        }
        p += wr;
        n -= (size_t)wr;
    }
    return true;
}

bool ds4_context_blob_put_text(const char *base_dir,
                               const char *text,
                               size_t len,
                               ds4_context_blob_ref *out,
                               char *err,
                               size_t err_len) {
    if (err && err_len) err[0] = '\0';
    if (!out) {
        ds4_blob_set_err(err, err_len, "missing blob output reference");
        return false;
    }
    memset(out, 0, sizeof(*out));
    if (!text && len) {
        ds4_blob_set_err(err, err_len, "missing blob text");
        return false;
    }
    char hex[65];
    ds4_sha256_hex(text ? text : "", len, hex);
    snprintf(out->id, sizeof(out->id), "sha256:%s", hex);
    out->bytes = (uint64_t)len;
    out->created_at = (uint64_t)time(NULL);

    char algo_dir[PATH_MAX];
    int dn = snprintf(algo_dir, sizeof(algo_dir), "%s/sha256", base_dir ? base_dir : "");
    if (dn < 0 || (size_t)dn >= sizeof(algo_dir)) {
        ds4_blob_set_err(err, err_len, "blob directory path too long");
        return false;
    }
    if (!ds4_blob_mkdir_p(algo_dir, err, err_len)) return false;
    if (!ds4_blob_join_path(base_dir, hex, out->path, sizeof(out->path), err, err_len))
        return false;

    int fd = open(out->path, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0 && errno == EEXIST) return true;
    if (fd < 0) {
        snprintf(err, err_len, "create blob %s: %s", out->path, strerror(errno));
        return false;
    }
    bool ok = ds4_blob_write_all(fd, text ? text : "", len, err, err_len);
    if (close(fd) != 0 && ok) {
        snprintf(err, err_len, "close blob %s: %s", out->path, strerror(errno));
        ok = false;
    }
    if (!ok) unlink(out->path);
    return ok;
}

char *ds4_context_blob_read_range(const char *base_dir,
                                  const char *id,
                                  uint64_t offset,
                                  uint64_t length,
                                  char *err,
                                  size_t err_len) {
    if (err && err_len) err[0] = '\0';
    if (!ds4_context_blob_id_valid(id)) {
        ds4_blob_set_err(err, err_len, "invalid blob id");
        return NULL;
    }
    if (length > (uint64_t)SIZE_MAX - 1u) {
        ds4_blob_set_err(err, err_len, "blob read length too large");
        return NULL;
    }
    char path[PATH_MAX];
    if (!ds4_blob_join_path(base_dir, id + 7, path, sizeof(path), err, err_len))
        return NULL;
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        snprintf(err, err_len, "open blob %s: %s", id, strerror(errno));
        return NULL;
    }
    if (fseeko(fp, 0, SEEK_END) != 0) {
        snprintf(err, err_len, "seek blob %s: %s", id, strerror(errno));
        fclose(fp);
        return NULL;
    }
    off_t end = ftello(fp);
    if (end < 0) {
        snprintf(err, err_len, "tell blob %s: %s", id, strerror(errno));
        fclose(fp);
        return NULL;
    }
    if (offset >= (uint64_t)end || length == 0) {
        fclose(fp);
        char *empty = malloc(1);
        if (!empty) ds4_blob_set_err(err, err_len, "out of memory");
        else empty[0] = '\0';
        return empty;
    }
    uint64_t available = (uint64_t)end - offset;
    if (length > available) length = available;
    if (offset > (uint64_t)LLONG_MAX || fseeko(fp, (off_t)offset, SEEK_SET) != 0) {
        snprintf(err, err_len, "seek blob %s: %s", id, strerror(errno));
        fclose(fp);
        return NULL;
    }
    char *buf = malloc((size_t)length + 1);
    if (!buf) {
        ds4_blob_set_err(err, err_len, "out of memory");
        fclose(fp);
        return NULL;
    }
    size_t got = fread(buf, 1, (size_t)length, fp);
    if (got != (size_t)length && ferror(fp)) {
        snprintf(err, err_len, "read blob %s: %s", id, strerror(errno));
        free(buf);
        fclose(fp);
        return NULL;
    }
    buf[got] = '\0';
    fclose(fp);
    return buf;
}
