/* ds4_upstream_compat.h - DS4 Studio / upstream contract.
 *
 * Bump DS4_STUDIO_UPSTREAM_API whenever a deliberate re-adaptation to a new
 * antirez snapshot lands.  The checks below are compile-time only: they cost
 * nothing at runtime and turn a silently-shifted upstream type or a vanished
 * symbol into a build error naming the thing that moved.
 *
 * This is the cheap half of the firewall.  The expensive half - Studio edits
 * that live *inside* upstream functions - is enforced by the anchor checks in
 * studio/studio_overlay.py.
 */
#ifndef DS4_UPSTREAM_COMPAT_H
#define DS4_UPSTREAM_COMPAT_H

#include "ds4.h"

#define DS4_STUDIO_UPSTREAM_API 1

/* The upstream commit these contracts were last reviewed against.  Kept as a
 * string so `make -f Makefile.studio studio-status` can print it. */
#define DS4_STUDIO_UPSTREAM_REV "a04f46fa423e45712c8c7e430eff422479f314a3"

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
#define DS4_STUDIO_ASSERT(cond, msg) _Static_assert(cond, msg)
#else
#define DS4_STUDIO_ASSERT(cond, msg) \
    typedef char ds4_studio_assert_##__LINE__[(cond) ? 1 : -1]
#endif

/* The runtime layer keeps its own copies of these; a silent shrink upstream
 * would corrupt them rather than fail to compile. */
DS4_STUDIO_ASSERT(sizeof(ds4_session *) == sizeof(void *),
                  "upstream ds4_session handle is not a plain pointer");

/* Session API the runtime/ext layer binds to.  Referencing each symbol makes a
 * rename or removal a link/compile error here instead of deep inside a
 * textually-included monolith. */
static inline void ds4_studio_compile_contracts(void) {
    (void)&ds4_session_create;
    (void)&ds4_session_free;
    (void)&ds4_session_sync;
    (void)&ds4_session_sample;
    (void)&ds4_session_ctx;
    (void)&ds4_session_pos;
}

#endif
