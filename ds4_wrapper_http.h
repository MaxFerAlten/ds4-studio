#ifndef DS4_WRAPPER_HTTP_H
#define DS4_WRAPPER_HTTP_H

#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"

int ds4_wrapper_http_start(ds4_wrapper *w, const ds4_wrapper_config *cfg);
void ds4_wrapper_http_stop(ds4_wrapper *w);

#endif
