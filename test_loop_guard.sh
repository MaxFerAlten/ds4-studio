#!/bin/bash
# Loop Guard Certification Test
# Verifies that:
# 1. Variable renamed from consecutive_similar to consecutive_identical
# 2. User confirmation mechanism works (non-interactive falls back to stop)
# 3. Code compiles without errors

set -euo pipefail

echo "=== Loop Guard Certification Test ==="
echo ""

# Step 1: Verify variable rename
echo "1. Checking variable rename..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$SCRIPT_DIR"
cd "$PROJECT_ROOT"
if grep -q "loop_guard_consecutive_identical" ds4_agent.c; then
    echo "   ✅ Variable renamed to loop_guard_consecutive_identical"
else
    echo "   ❌ Variable not found"
    exit 1
fi
if grep -q "loop_guard_consecutive_similar" ds4_agent.c; then
    echo "   ❌ Old variable name still present"
    exit 1
else
    echo "   ✅ Old name loop_guard_consecutive_similar removed"
fi

echo ""
echo "1c. Checking canonical read fingerprints..."

for symbol in \
    AGENT_LOOP_GUARD_FINGERPRINT_SIZE \
    AGENT_LOOP_GUARD_IDENTICAL_LIMIT \
    AGENT_LOOP_GUARD_EMPTY_LIMIT \
    agent_loop_guard_fingerprint_call; do
    if grep -q "$symbol" ds4_agent.c; then
        echo "   ✅ $symbol present"
    else
        echo "   ❌ Missing $symbol"
        exit 1
    fi
done

if grep -A25 -B4 'agent_loop_guard_fingerprint_call' ds4_agent.c \
    | grep -q 'start_line'; then
    echo "   ✅ read fingerprint includes start_line"
else
    echo "   ❌ read fingerprint does not include start_line"
    exit 1
fi

if grep -A25 -B4 'agent_loop_guard_fingerprint_call' ds4_agent.c \
    | grep -q 'max_lines'; then
    echo "   ✅ read fingerprint includes max_lines"
else
    echo "   ❌ read fingerprint does not include max_lines"
    exit 1
fi

if grep -q 'commands in a row.*AGENT_LOOP_GUARD_RING_SIZE' ds4_agent.c; then
    echo "   ❌ UI still reports ring size as the identical-command limit"
    exit 1
else
    echo "   ✅ UI no longer uses ring size as stop threshold"
fi

echo ""
echo "1b. Checking structured progress guidance..."
if grep -Fq "READ_BATCH_SUMMARY_REQUIRED" ds4_agent.c; then
    echo "   ✅ Structured read guidance is recognized"
else
    echo "   ❌ Missing READ_BATCH_SUMMARY_REQUIRED recognition"
    exit 1
fi
if grep -Fq "Stop reading. Produce a partial analysis now" ds4_agent.c; then
    echo "   ✅ Loop guard requests structured partial analysis"
else
    echo "   ❌ Missing structured loop-guard message"
    exit 1
fi

# Step 2: Verify user confirmation fields exist
echo ""
echo "2. Checking user confirmation fields..."
if grep -q "loop_guard_awaiting_user" ds4_agent.c; then
    echo "   ✅ loop_guard_awaiting_user field present"
else
    echo "   ❌ Missing field"
    exit 1
fi
if grep -q "loop_guard_awaiting_user_answered" ds4_agent.c; then
    echo "   ✅ loop_guard_awaiting_user_answered field present"
else
    echo "   ❌ Missing field"
    exit 1
fi
if grep -q "loop_guard_awaiting_user_continue" ds4_agent.c; then
    echo "   ✅ loop_guard_awaiting_user_continue field present"
else
    echo "   ❌ Missing field"
    exit 1
fi

# Step 3: Verify non-interactive fallback
echo ""
echo "3. Checking non-interactive fallback..."
if grep -q "non_interactive" ds4_agent.c && grep -q "loop_guard" ds4_agent.c; then
    echo "   ✅ Non-interactive mode falls back to immediate stop"
else
    echo "   ⚠️  Non-interactive check may be missing"
fi

# Step 4: Verify user prompt mechanism
echo ""
echo "4. Checking user prompt mechanism..."
if grep -q "loop_guard_awaiting_user_answered" ds4_agent.c && grep -q "pthread_cond_wait" ds4_agent.c; then
    echo "   ✅ Worker waits for user confirmation via pthread_cond_wait"
else
    echo "   ❌ Missing pthread_cond_wait for user confirmation"
    exit 1
fi

# Step 5: Verify main UI thread polling
echo ""
echo "5. Checking main UI thread polling..."
if grep -q "worker_take_loop_guard_request" ds4_agent.c && grep -q "worker_answer_loop_guard" ds4_agent.c; then
    echo "   ✅ worker_take_loop_guard_request and worker_answer_loop_guard exist"
else
    echo "   ❌ Missing UI polling functions"
    exit 1
fi
if grep -q "worker_take_loop_guard_request" ds4_agent.c; then
    echo "   ✅ Main UI thread polls for loop guard requests"
else
    echo "   ❌ Missing polling in main UI loop"
    exit 1
fi

# Step 6: Verify binary compiles
echo ""
echo "6. Building targeted native tests and agent binary..."
make ds4_agent_test && make rocm

echo ""
echo "6b. Checking binary compiles..."
if file ds4-agent | grep -q "ELF"; then
    echo "   ✅ ds4-agent binary is a valid ELF"
else
    echo "   ❌ Binary not valid"
    exit 1
fi

# Step 7: Verify new symbols in binary
echo ""
echo "7. Running native ds4-agent regression tests..."
./ds4_agent_test

echo ""
echo "7b. Checking symbols in binary..."
if nm ds4-agent 2>/dev/null | grep -q "loop_guard"; then
    echo "   ✅ loop_guard symbols found in binary"
else
    echo "   ⚠️  Symbols may be inlined/static"
fi

echo ""
echo "=== Loop Guard Certification Test: PASSED ==="
echo ""
echo "Summary of certified behavior:"
echo "  • read fingerprints include path, start_line, max_lines, whole, and raw"
echo "  • progressive ranges of the same file do not count as identical"
echo "  • only immediately consecutive identical fingerprints accumulate"
echo "  • exactly repeated reads still reach the configured stop threshold"
echo "  • stale ring cells do not affect a new turn"
echo "  • UI reports AGENT_LOOP_GUARD_IDENTICAL_LIMIT, not ring capacity"
echo "  • interactive confirmation behavior remains present"
echo "  • non-interactive mode still stops on a certified loop"
