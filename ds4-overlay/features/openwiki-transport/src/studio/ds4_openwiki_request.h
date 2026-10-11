#ifndef DS4_OPENWIKI_REQUEST_H
#define DS4_OPENWIKI_REQUEST_H

#include <stdbool.h>

/* Return true only for a well-formed top-level request.openwiki_enabled=true.
 * Missing, duplicate, malformed, or non-boolean values fail closed. */
bool ds4_ow_request_enabled(const char *json);

#endif
