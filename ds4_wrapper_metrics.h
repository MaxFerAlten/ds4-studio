#ifndef DS4_WRAPPER_METRICS_H
#define DS4_WRAPPER_METRICS_H

#include "ds4_wrapper.h"

#include <stddef.h>

/* Write a JSON status blob into buf (caller must free).
 * Returns the allocated string or NULL on failure. */
char *ds4_wrapper_status_json(const ds4_wrapper *w);

#endif
