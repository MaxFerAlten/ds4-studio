CC ?= cc
AR ?= ar
CPPFLAGS ?=
CFLAGS ?=
LDFLAGS ?=
LDLIBS ?= -lm
BASE_CFLAGS = -std=c11 -O2 -Wall -Wextra -Werror -Wpedantic
SAN_FLAGS = -fsanitize=address,undefined -fno-omit-frame-pointer -g
HEADER = include/ds4di_spec_policy.h
SOURCE = src/ds4di_spec_policy.c
TEST = tests/test_spec_policy.c

.PHONY: all shared test test-asan clean

all: build/libds4di_spec_policy.a

build:
	mkdir -p $@

build/ds4di_spec_policy.o: $(SOURCE) $(HEADER) Makefile | build
	$(CC) $(CPPFLAGS) -Iinclude $(CFLAGS) $(BASE_CFLAGS) -c $(SOURCE) -o $@

build/libds4di_spec_policy.a: build/ds4di_spec_policy.o
	$(AR) rcs $@ $<

build/test_spec_policy: $(TEST) $(SOURCE) $(HEADER) Makefile | build
	$(CC) $(CPPFLAGS) -Iinclude $(CFLAGS) $(BASE_CFLAGS) $(SOURCE) $(TEST) $(LDFLAGS) $(LDLIBS) -o $@

build/test_spec_policy_asan: $(TEST) $(SOURCE) $(HEADER) Makefile | build
	$(CC) $(CPPFLAGS) -Iinclude $(CFLAGS) $(BASE_CFLAGS) $(SAN_FLAGS) $(SOURCE) $(TEST) $(LDFLAGS) $(LDLIBS) -o $@

# Shared object for the Python oracle cross-check (python/tests/test_c_oracle.py).
shared: build/libds4di_spec_policy.so

build/libds4di_spec_policy.so: $(SOURCE) $(HEADER) Makefile | build
	$(CC) $(CPPFLAGS) -Iinclude $(CFLAGS) $(BASE_CFLAGS) -fPIC -shared $(SOURCE) $(LDFLAGS) $(LDLIBS) -o $@

test: build/test_spec_policy
	./build/test_spec_policy

test-asan: build/test_spec_policy_asan
	./build/test_spec_policy_asan

clean:
	rm -rf build
