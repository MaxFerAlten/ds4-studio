# Part of DS4-Studio DeepInfer integration (PR-05). Builds the golden oracle
# CPU-only into build/, outside the DS4 tree; no DS4 file or object is touched.
ROOT := ../../../..
BUILD := build
CC ?= cc
CFLAGS := -O1 -g -std=c99 -D_GNU_SOURCE -fno-finite-math-only -DDS4_NO_GPU -Wno-unused-function -I$(ROOT)
LDLIBS := -lm -pthread
SRCS := ds4 ds4_image ds4_distributed ds4_tp ds4_ssd ds4_layer_pack ds4_engram ds4_help ds4_kvstore rax
OBJS := $(SRCS:%=$(BUILD)/%.o)

all: $(BUILD)/ds4_render_oracle

$(BUILD)/%.o: $(ROOT)/%.c | $(BUILD)
	$(CC) $(CFLAGS) -c -o $@ $<

$(BUILD)/ds4_render_oracle.o: ds4_render_oracle.c $(ROOT)/ds4_server.c | $(BUILD)
	$(CC) $(CFLAGS) -c -o $@ ds4_render_oracle.c

$(BUILD)/ds4_render_oracle: $(BUILD)/ds4_render_oracle.o $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)

.PHONY: all clean
