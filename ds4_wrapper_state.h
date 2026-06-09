#ifndef DS4_WRAPPER_STATE_H
#define DS4_WRAPPER_STATE_H

#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"

#include <stddef.h>

int ds4_wrapper_init(ds4_wrapper *w, ds4_engine *engine, const ds4_wrapper_config *cfg);
void ds4_wrapper_close(ds4_wrapper *w);

int ds4_wrapper_startup_session(ds4_wrapper *w, ds4_wrap_mode mode, char *err, size_t err_len);

int ds4_wrapper_enter_request(ds4_wrapper *w, ds4_wrap_mode required, char *err, size_t err_len);
void ds4_wrapper_leave_request(ds4_wrapper *w);

int ds4_wrapper_switch_mode(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len);

int ds4_wrapper_freeze_active_session(ds4_wrapper *w, char *err, size_t err_len);
int ds4_wrapper_thaw_session(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len);

#endif
