#define _GNU_SOURCE
#include "ds4_openwiki_client.h"

#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <poll.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

enum response_kind { RESP_OK, RESP_DUP_LENGTH, RESP_CHUNKED, RESP_TRUNCATED, RESP_OVERSIZE, RESP_BAD_UTF8, RESP_BAD_REQUEST_ID, RESP_DELAY, RESP_DELAY_BODY, RESP_CLOSE, RESP_503 };

struct mock_server {
    char dir[128];
    char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
    int listener;
    enum response_kind kind;
    pthread_t thread;
    char request[12000];
    atomic_bool request_received;
    atomic_bool body_stalled;
};

static volatile sig_atomic_t test_sigint;
static void test_sigint_handler(int sig) { (void)sig; test_sigint = 1; }
static int64_t test_monotonic_ms(void) {
    struct timespec ts;
    assert(clock_gettime(CLOCK_MONOTONIC, &ts) == 0);
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

struct signal_job { struct mock_server *server; bool wait_for_body; };
static void *send_test_sigint(void *arg) {
    struct signal_job *job = arg;
    struct timespec pause = {0, 1000 * 1000};
    for (unsigned i = 0; i < 1000; ++i) {
        bool ready = job->wait_for_body
            ? atomic_load(&job->server->body_stalled)
            : atomic_load(&job->server->request_received);
        if (ready) break;
        nanosleep(&pause, NULL);
    }
    nanosleep(&pause, NULL);
    assert(kill(getpid(), SIGINT) == 0);
    return NULL;
}

static bool cancel_on_sigint(void *ud) { (void)ud; return test_sigint != 0; }

static void send_bytes(int fd, const void *data, size_t len) {
    const char *p = (const char *)data;
    while (len) {
        ssize_t n = send(fd, p, len, MSG_NOSIGNAL);
        if (n > 0) { p += n; len -= (size_t)n; continue; }
        if (n < 0 && errno == EINTR) continue;
        break;
    }
}

static void *serve_one(void *arg) {
    struct mock_server *srv = arg;
    struct pollfd ready = { .fd = srv->listener, .events = POLLIN, .revents = 0 };
    int fd;
    if (poll(&ready, 1, 1000) <= 0) return NULL;
    fd = accept(srv->listener, NULL, NULL);
    size_t n = 0, content_length = 0, body_bytes = 0;
    char request_id[96] = "";
    if (fd < 0) return NULL;
    while (n + 1 < sizeof(srv->request)) {
        ssize_t got = recv(fd, srv->request + n, 1, 0);
        if (got <= 0) goto close_fd;
        ++n;
        srv->request[n] = '\0';
        if (n >= 4 && !memcmp(srv->request + n - 4, "\r\n\r\n", 4)) break;
    }
    {
        char *cl = strstr(srv->request, "Content-Length: ");
        char *rid = strstr(srv->request, "X-Request-Id: ");
        assert(cl && rid);
        content_length = (size_t)strtoul(cl + strlen("Content-Length: "), NULL, 10);
        rid += strlen("X-Request-Id: ");
        {
            size_t k = 0;
            while (rid[k] && rid[k] != '\r' && k + 1 < sizeof(request_id)) { request_id[k] = rid[k]; ++k; }
            request_id[k] = '\0';
        }
    }
    while (body_bytes < content_length) {
        size_t room = sizeof(srv->request) - n - 1;
        size_t want = content_length - body_bytes;
        ssize_t got = recv(fd, srv->request + n, want < room ? want : room, 0);
        if (got <= 0) goto close_fd;
        body_bytes += (size_t)got;
        n += (size_t)got;
        srv->request[n] = '\0';
    }
    atomic_store(&srv->request_received, true);
    if (srv->kind == RESP_CLOSE) goto close_fd;
    if (srv->kind == RESP_DELAY) {
        struct timespec delay = {0, 250 * 1000 * 1000};
        nanosleep(&delay, NULL);
    }
    {
        static const unsigned char good_body[] = "ok \xcf\x80";
        static const unsigned char bad_body[] = {0xc0, 0xaf};
        size_t body_len = sizeof(good_body) - 1;
        const unsigned char *body = good_body;
        char *large = NULL;
        int status = srv->kind == RESP_503 ? 503 : 200;
        const char *type = status == 200 ? "text/plain; charset=utf-8" : "application/json";
        if (srv->kind == RESP_BAD_UTF8) { body = bad_body; body_len = sizeof(bad_body); }
        if (srv->kind == RESP_OVERSIZE) {
            body_len = DS4_OW_RESPONSE_CAP + 1;
            large = malloc(body_len);
            assert(large);
            memset(large, 'x', body_len);
            body = (const unsigned char *)large;
        }
        if (srv->kind == RESP_TRUNCATED) ++body_len;
        {
            char header[1024];
            const char *response_id = srv->kind == RESP_BAD_REQUEST_ID ? "mismatched-id" : request_id;
            int m = snprintf(header, sizeof(header), "HTTP/1.1 %d %s\r\nContent-Length: %zu\r\n%s%sX-DS4-OW-Protocol: 1\r\nX-DS4-OW-Request-Id: %s\r\nContent-Type: %s\r\nConnection: close\r\n\r\n",
                             status, status == 200 ? "OK" : "Service Unavailable", body_len,
                             srv->kind == RESP_DUP_LENGTH ? "Content-Length: 5\r\n" : "",
                             srv->kind == RESP_CHUNKED ? "Transfer-Encoding: chunked\r\n" : "",
                             response_id, type);
            assert(m > 0 && (size_t)m < sizeof(header));
            send_bytes(fd, header, (size_t)m);
        }
        if (srv->kind == RESP_DELAY_BODY) {
            size_t first = body_len > 1 ? body_len / 2 : body_len;
            send_bytes(fd, body, first);
            atomic_store(&srv->body_stalled, true);
            struct timespec delay = {0, 500 * 1000 * 1000};
            nanosleep(&delay, NULL);
            send_bytes(fd, body + first, body_len - first);
        } else {
            send_bytes(fd, body, srv->kind == RESP_TRUNCATED ? body_len - 1 : body_len);
        }
        free(large);
    }
close_fd:
    close(fd);
    return NULL;
}

static void mock_start(struct mock_server *srv, enum response_kind kind) {
    struct sockaddr_un addr;
    memset(srv, 0, sizeof(*srv));
    strcpy(srv->dir, "/tmp/ds4-ow-test-XXXXXX");
    assert(mkdtemp(srv->dir));
    assert(chmod(srv->dir, 0700) == 0);
    assert(snprintf(srv->path, sizeof(srv->path), "%s/gateway.sock", srv->dir) > 0);
    srv->kind = kind;
    atomic_init(&srv->request_received, false);
    atomic_init(&srv->body_stalled, false);
    srv->listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    assert(srv->listener >= 0);
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strcpy(addr.sun_path, srv->path);
    if (bind(srv->listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("mock bind"); abort(); }
    assert(chmod(srv->path, 0600) == 0);
    assert(listen(srv->listener, 1) == 0);
    assert(pthread_create(&srv->thread, NULL, serve_one, srv) == 0);
}

static void mock_stop(struct mock_server *srv) {
    assert(pthread_join(srv->thread, NULL) == 0);
    close(srv->listener);
    unlink(srv->path);
    rmdir(srv->dir);
}

static ds4_ow_config config_for(const struct mock_server *srv) {
    ds4_ow_config cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.mode = DS4_OW_ON;
    strcpy(cfg.socket_path, srv->path);
    strcpy(cfg.workspace_id, "fixture");
    cfg.search_timeout_ms = 500;
    cfg.read_timeout_ms = 500;
    cfg.max_request_bytes = DS4_OW_REQUEST_CAP;
    cfg.max_response_bytes = DS4_OW_RESPONSE_CAP;
    cfg.expected_peer_uid = geteuid();
    return cfg;
}

static bool cancel_now(void *ud) { (void)ud; return true; }
struct cancel_after { unsigned calls, threshold; };
static bool cancel_later(void *ud) {
    struct cancel_after *state = ud;
    return ++state->calls >= state->threshold;
}

static void test_search_and_read_json_contract(void) {
    struct mock_server srv;
    ds4_ow_config cfg;
    char *out = NULL, err[128] = {0};
    size_t out_len = 0;
    const char *paths[] = {"src/agent.c"};
    const char *sections[] = {"KV reuse"};
    mock_start(&srv, RESP_OK);
    cfg = config_for(&srv);
    assert(ds4_ow_search(&cfg, "KV \"reuse\"", paths, 1, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_OK);
    assert(out && out_len == strlen("ok \xcf\x80") && !strcmp(out, "ok \xcf\x80"));
    assert(strstr(srv.request, "POST /v1/wiki/search HTTP/1.1\r\n"));
    assert(strstr(srv.request, "Content-Length: "));
    assert(strstr(srv.request, "\"workspaceId\":\"fixture\""));
    assert(strstr(srv.request, "\"query\":\"KV \\\"reuse\\\"\""));
    assert(strstr(srv.request, "\"paths\":[\"src/agent.c\"]"));
    assert(!strstr(srv.request, "\"root\"") && !strstr(srv.request, "\"socket\""));
    free(out);
    mock_stop(&srv);

    mock_start(&srv, RESP_OK);
    cfg = config_for(&srv);
    assert(ds4_ow_read(&cfg, "docs/session.md", sections, 1, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_OK);
    assert(strstr(srv.request, "POST /v1/wiki/read HTTP/1.1\r\n"));
    assert(strstr(srv.request, "\"page\":\"docs/session.md\""));
    assert(strstr(srv.request, "\"sections\":[\"KV reuse\"]"));
    free(out);
    mock_stop(&srv);
}

static void expect_response(enum response_kind kind, ds4_ow_result expected) {
    struct mock_server srv;
    ds4_ow_config cfg;
    char *out = (char *)1, err[128] = {0};
    size_t out_len = 88;
    mock_start(&srv, kind);
    cfg = config_for(&srv);
    assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == expected);
    if (expected != DS4_OW_OK) assert(out == NULL && out_len == 0);
    mock_stop(&srv);
}

static void test_strict_http_negative_cases(void) {
    expect_response(RESP_DUP_LENGTH, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_CHUNKED, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_TRUNCATED, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_OVERSIZE, DS4_OW_OVERSIZE);
    expect_response(RESP_BAD_UTF8, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_BAD_REQUEST_ID, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_CLOSE, DS4_OW_PROTOCOL_ERROR);
    expect_response(RESP_503, DS4_OW_UPSTREAM_DOWN);
}

static void test_timeout_cancel_and_sigpipe_safety(void) {
    struct mock_server srv;
    ds4_ow_config cfg;
    char *out = NULL, err[128] = {0};
    size_t out_len = 0;
    struct cancel_after cancel = {0, 4};
    mock_start(&srv, RESP_DELAY);
    cfg = config_for(&srv);
    cfg.search_timeout_ms = 40;
    assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_TIMEOUT);
    assert(out == NULL && out_len == 0);
    mock_stop(&srv);

    mock_start(&srv, RESP_OK);
    cfg = config_for(&srv);
    assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, cancel_now, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
    mock_stop(&srv);

    mock_start(&srv, RESP_DELAY);
    cfg = config_for(&srv);
    cfg.search_timeout_ms = 1000;
    assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, cancel_later, &cancel, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
    mock_stop(&srv);
}

static void test_sigint_cancels_connect_receive_and_read(void) {
    struct sigaction action = {0}, old_action;
    action.sa_handler = test_sigint_handler;
    sigemptyset(&action.sa_mask);
    assert(sigaction(SIGINT, &action, &old_action) == 0);

    /* The client's pre-connect cancellation check must honor a delivered SIGINT. */
    {
        struct mock_server srv;
        ds4_ow_config cfg;
        char *out = NULL, err[128] = {0};
        size_t out_len = 0;
        mock_start(&srv, RESP_OK);
        cfg = config_for(&srv);
        test_sigint = 0;
        assert(raise(SIGINT) == 0);
        assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, cancel_on_sigint,
                             NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
        assert(!atomic_load(&srv.request_received));
        test_sigint = 0;
        mock_stop(&srv);
    }

    /* SIGINT while waiting for response headers exits within one poll slice. */
    {
        struct mock_server srv;
        struct signal_job job = {&srv, false};
        pthread_t signal_thread;
        ds4_ow_config cfg;
        char *out = NULL, err[128] = {0};
        size_t out_len = 0;
        mock_start(&srv, RESP_DELAY);
        cfg = config_for(&srv);
        test_sigint = 0;
        assert(pthread_create(&signal_thread, NULL, send_test_sigint, &job) == 0);
        int64_t started = test_monotonic_ms();
        assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, cancel_on_sigint,
                             NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
        assert(test_monotonic_ms() - started < 300);
        assert(out == NULL && out_len == 0);
        assert(pthread_join(signal_thread, NULL) == 0);
        test_sigint = 0;
        mock_stop(&srv);
    }

    /* Partial read content is discarded when SIGINT arrives mid-body. */
    {
        struct mock_server srv;
        struct signal_job job = {&srv, true};
        pthread_t signal_thread;
        ds4_ow_config cfg;
        const char *sections[] = {"intro"};
        char *out = NULL, err[128] = {0};
        size_t out_len = 0;
        mock_start(&srv, RESP_DELAY_BODY);
        cfg = config_for(&srv);
        test_sigint = 0;
        assert(pthread_create(&signal_thread, NULL, send_test_sigint, &job) == 0);
        int64_t started = test_monotonic_ms();
        assert(ds4_ow_read(&cfg, "page.md", sections, 1, cancel_on_sigint,
                           NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
        assert(test_monotonic_ms() - started < 300);
        assert(out == NULL && out_len == 0);
        assert(pthread_join(signal_thread, NULL) == 0);
        test_sigint = 0;
        mock_stop(&srv);
    }

    assert(sigaction(SIGINT, &old_action, NULL) == 0);
}

static void test_repeated_cancel_and_gateway_restart_recovery(void) {
    for (unsigned i = 0; i < 20; ++i) {
        struct mock_server srv;
        ds4_ow_config cfg;
        struct cancel_after cancel = {0, 4};
        char *out = NULL, err[128] = {0};
        size_t out_len = 0;
        mock_start(&srv, RESP_DELAY);
        cfg = config_for(&srv);
        assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, cancel_later,
                             &cancel, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
        assert(out == NULL && out_len == 0);
        mock_stop(&srv);
    }

    /* A canceled request does not poison a new connection after gateway restart. */
    {
        struct mock_server srv;
        ds4_ow_config cfg;
        struct cancel_after cancel = {0, 4};
        char *out = NULL, err[128] = {0};
        size_t out_len = 0;
        mock_start(&srv, RESP_DELAY);
        cfg = config_for(&srv);
        assert(ds4_ow_search(&cfg, "first", NULL, 0, 3, cancel_later,
                             &cancel, &out, &out_len, err, sizeof(err)) == DS4_OW_CANCELLED);
        mock_stop(&srv);

        mock_start(&srv, RESP_OK);
        cfg = config_for(&srv);
        assert(ds4_ow_search(&cfg, "follow-up", NULL, 0, 3, NULL, NULL,
                             &out, &out_len, err, sizeof(err)) == DS4_OW_OK);
        assert(out && !strcmp(out, "ok \xcf\x80"));
        free(out);
        mock_stop(&srv);
    }
}

static void test_reject_bad_arguments_before_connect(void) {
    ds4_ow_config cfg;
    char *out = (char *)1, err[128] = {0};
    size_t out_len = 42;
    const char *sections[] = {"intro"};
    memset(&cfg, 0, sizeof(cfg));
    cfg.mode = DS4_OW_ON;
    strcpy(cfg.socket_path, "/tmp/does-not-exist.sock");
    strcpy(cfg.workspace_id, "fixture");
    cfg.max_request_bytes = DS4_OW_REQUEST_CAP;
    cfg.max_response_bytes = DS4_OW_RESPONSE_CAP;
    cfg.search_timeout_ms = 100;
    assert(ds4_ow_search(&cfg, "bad\nquery", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_BAD_ARG);
    assert(out == NULL && out_len == 0);
    assert(ds4_ow_search(&cfg, "bad\xC2\x9Fquery", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_BAD_ARG);
    assert(ds4_ow_read(&cfg, "~/secret.md", sections, 1, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_BAD_ARG);
    assert(ds4_ow_read(&cfg, "C:/secret.md", sections, 1, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_BAD_ARG);
    assert(ds4_ow_read(&cfg, "../secret.md", sections, 1, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_BAD_ARG);
    cfg.mode = DS4_OW_OFF;
    assert(ds4_ow_search(&cfg, "query", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_DISABLED);
}

static void test_gateway_offline_is_bounded(void) {
    ds4_ow_config cfg;
    char *out = NULL, err[128] = {0};
    size_t out_len = 0;
    char dir[] = "/tmp/ds4-ow-offline-XXXXXX";
    struct sockaddr_un addr;
    int fd;
    assert(mkdtemp(dir) != NULL);
    memset(&cfg, 0, sizeof(cfg));
    cfg.mode = DS4_OW_ON;
    cfg.expected_peer_uid = geteuid();
    cfg.search_timeout_ms = 100;
    cfg.max_request_bytes = DS4_OW_REQUEST_CAP;
    cfg.max_response_bytes = DS4_OW_RESPONSE_CAP;
    strcpy(cfg.workspace_id, "fixture");
    assert(snprintf(cfg.socket_path, sizeof(cfg.socket_path), "%s/gateway.sock", dir) > 0);
    fd = socket(AF_UNIX, SOCK_STREAM, 0);
    assert(fd >= 0);
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strcpy(addr.sun_path, cfg.socket_path);
    assert(bind(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0);
    close(fd); /* Keep a trusted socket inode without a listening gateway. */
    assert(chmod(cfg.socket_path, 0600) == 0);
    assert(ds4_ow_search(&cfg, "topic", NULL, 0, 3, NULL, NULL,
                         &out, &out_len, err, sizeof(err)) == DS4_OW_UPSTREAM_DOWN);
    assert(out == NULL && out_len == 0);
    unlink(cfg.socket_path);
    rmdir(dir);
}

static void test_utf8_continuation_byte_is_not_a_control(void) {
    struct mock_server srv;
    ds4_ow_config cfg;
    char *out = NULL, err[128] = {0};
    size_t out_len = 0;
    mock_start(&srv, RESP_OK);
    cfg = config_for(&srv);
    assert(ds4_ow_search(&cfg, "emoji \xF0\x9F\x98\x80", NULL, 0, 3, NULL, NULL, &out, &out_len, err, sizeof(err)) == DS4_OW_OK);
    free(out);
    mock_stop(&srv);
}

static void test_socket_symlink_and_mode_rejected(void) {
    struct mock_server srv;
    char alias[sizeof(((struct sockaddr_un *)0)->sun_path)];
    mock_start(&srv, RESP_OK);
    assert(ds4_ow_socket_is_trusted(srv.path, geteuid()));
    assert(snprintf(alias, sizeof(alias), "%s/alias.sock", srv.dir) > 0);
    assert(symlink(srv.path, alias) == 0);
    assert(!ds4_ow_socket_is_trusted(alias, geteuid()));
    unlink(alias);
    assert(chmod(srv.path, 0660) == 0);
    assert(!ds4_ow_socket_is_trusted(srv.path, geteuid()));
    mock_stop(&srv);
}

int main(void) {
    signal(SIGPIPE, SIG_DFL); /* Client must survive peer closure independently of process disposition. */
    test_search_and_read_json_contract();
    test_strict_http_negative_cases();
    test_timeout_cancel_and_sigpipe_safety();
    test_sigint_cancels_connect_receive_and_read();
    test_repeated_cancel_and_gateway_restart_recovery();
    test_reject_bad_arguments_before_connect();
    test_gateway_offline_is_bounded();
    test_utf8_continuation_byte_is_not_a_control();
    test_socket_symlink_and_mode_rejected();
    puts("OpenWiki UDS client tests: PASS");
    return 0;
}
