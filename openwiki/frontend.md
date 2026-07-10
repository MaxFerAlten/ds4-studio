# FE/Frontend Overview

## UI Architecture

The frontend UI is a Vue.js SPA (Single Page Application) built using TypeScript. Key components:
1. **Core Structure**
   - `App.jsx`: Root component using Vite for fast HMR
   - Routing: Loads panels like `ChatPanel` and `PageAgentPanel` via `App.jsx`
   - Main panels:
     - `ChatPanel.jsx`: Main conversation interface
     - `HistoryPanel.jsx`: Message history storage
     - `RightRailPanels.jsx`: Side panels for context navigation

2. **Agent Integration**
   - `pageagent/`: Contains WebSocket handler for PageAgent API
   - `pageagent/`: Layout component rendering: