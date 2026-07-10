# Architecture Overview

DS4-Studio is a high-performance AI ecosystem centered around the **DwarfStar (ds4)** native inference engine, specifically optimized for the DeepSeek V4 model family.

## High-Level Components

### 1. DS4 Inference Engine (`/ds4.c`, `/ds4_server.c`)
The core of the project. Unlike generic runners, DS4 is a self-contained engine designed for maximum efficiency on high-memory machines.
- **Backend Support**: Targets Metal (macOS), CUDA (NVIDIA/DGX Spark), and ROCm (Strix Halo).
- **KV Cache Management**: Treats the KV cache as a "first-class disk citizen," allowing for SSD streaming to run models larger than available RAM.
- **Distributed Inference**: Supports splitting transformer layers across multiple machines via a coordinator/worker architecture to enable massive model runs (e.g., DeepSeek V4 PRO Q4) and accelerated prefill.

### 2. Agent Framework (`/ds4_agent.c`, `frontend/server/`)
A sophisticated agent orchestration layer that integrates the inference engine with external tools and a user interface.
- **Native Agent Commands**: Implemented in `ds4_agent.c` and mirrored in the JS server for seamless coordination.
- **Tool Negotiation**: The server manages tool capabilities, output compression (`toolOutputCompressor.mjs`), and safety guards (`claimGuard.mjs`).
- **Runtime Rules**: `agentRuntimeRules.mjs` defines the constraints and behaviors of the agents.

### 3. PageAgent (`frontend/src/pageagent/`, `frontend/server/pageAgent*`)
A specialized agent capable of interacting with and managing web pages.
- **Bridge Architecture**: Uses `pageAgentBridge.mjs` to connect the high-level agent logic with the browser-side proxy.
- **Capabilities**: Includes safety auditing (`pageAgentAudit.mjs`), benchmarking (`pageAgentBench.mjs`), and an MCP (Model Context Protocol) integration (`pageagentMcp.mjs`).

### 4. Crawl Service (`crawl_service/`)
A Python-based service utilizing **Crawl4AI** to provide grounding and research capabilities.
- **Grounding**: `ds4_crawl_grounding.c` integrates crawled data back into the inference pipeline.
- **Storage**: Uses a durable storage system (SQL migrations in `crawl_service/src/ds4_crawl/migrations/`) for artifacts and previews.
- **Pipeline**: Managed by `runner.py` and `repository.py` to fetch and process web content for the agent.

## Data Flow

1. **User Input** $\rightarrow$ **Frontend UI** $\rightarrow$ **JS Server**
2. **JS Server** $\rightarrow$ (Determines if tool use is needed) $\rightarrow$ **Crawl Service** / **Local Tools**
3. **Tool Results** $\rightarrow$ **DS4 Engine** (with Grounding/Compression) $\rightarrow$ **Model Generation**
4. **Model Output** $\rightarrow$ **JS Server** $\rightarrow$ **Frontend UI**

## Key Technical Distinctions

- **SSD Streaming**: Routed MoE experts are cached in RAM and loaded from GGUF on-demand, bypassing traditional RAM limits.
- **Distributed Pipelining**: Prefill is accelerated by processing different micro-batches across multiple GPUs in an assembly-line fashion.
- **Tight Integration**: The project avoids generic wrappers, implementing a dedicated path from the GGUF loader to the HTTP API and the UI.