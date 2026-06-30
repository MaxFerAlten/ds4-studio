#!/bin/bash
# Simulazione del comportamento del loop guard con avviso utente
# Mostra cosa vedrebbe l'utente quando la guardia scatta

set -e

echo "=== Simulazione Loop Guard con Avviso Utente ==="
echo ""
echo "Scenario: il modello emette 4 comandi identici consecutivi"
echo "          (es. 4 read sullo stesso file per macchina lenta)"
echo ""

# Step 1: Mostra il messaggio che il worker pubblica
echo "┌─────────────────────────────────────────────────────────┐"
echo "│ [loop-guard] 4 comandi identici consecutivi rilevati   │"
echo "│ Il worker thread si blocca in attesa della risposta...  │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""

# Step 2: Mostra il prompt che l'utente vede nel terminale
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ⚠️  Loop guard triggered: the model issued 8 identical  ║"
echo "║     commands in a row.                                    ║"
echo "║     This may indicate machine slowness rather than        ║"
echo "║     a real loop.                                          ║"
echo "║                                                           ║"
echo "║  Continue waiting? (y) or stop the turn? (n) [y/n]       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Step 3: Simula la scelta dell'utente
echo "Attendo input utente (simulato)..."
echo ""

# Caso 1: Utente sceglie 'y' (continua)
echo "▶ CASO 1: Utente digita 'y' (continua)"
echo ""
echo "  Il worker riceve: continue_flag = true"
echo "  I contatori vengono resettati:"
echo "    loop_guard_consecutive_empty = 0"
echo "    loop_guard_consecutive_identical = 0"
echo "    loop_guard_ring_pos = 0"
echo "  Il worker pubblica:"
echo "    [loop-guard] User chose to continue, resetting guard."
echo "  L'elaborazione riprende normalmente."
echo ""

# Caso 2: Utente sceglie 'n' (stop)
echo "▶ CASO 2: Utente digita 'n' (stop)"
echo ""
echo "  Il worker riceve: continue_flag = false"
echo "  Il worker inserisce nel transcript:"
echo "    Tool error: loop detected — identical commands repeat"
echo "    without progress."
echo "  Il turn termina e il modello vede l'errore."
echo ""

# Caso 3: Timeout (30 secondi senza risposta)
echo "▶ CASO 3: Timeout dopo 30 secondi"
echo ""
echo "  agent_prompt_yes_no_ex restituisce: timed_out=true"
echo "  timeout_answer = AGENT_YES_NO_AUTO_NO → continue_flag = false"
echo "  Stesso comportamento del CASO 2."
echo ""

# Caso 4: Non-interactive mode
echo "▶ CASO 4: Modalità non-interattiva (--non-interactive)"
echo ""
echo "  La guardia scatta immediatamente senza chiedere all'utente:"
echo "    Tool error: loop detected — identical commands repeat"
echo "    without progress. Please provide a final answer."
echo "  Il turn termina immediatamente."
echo ""

echo "=== Verifica codice ==="
echo ""
echo "Punti di verifica:"
echo "  • worker_run_turn (riga ~8960): rileva 4 comandi identici"
echo "  • worker_main (riga ~9148): chiama worker_run_turn"
echo "  • main UI loop (riga ~11056): rileva loop_guard_awaiting_user"
echo "  • agent_prompt_yes_no_ex: mostra il prompt all'utente"
echo "  • worker_answer_loop_guard: sblocca il worker thread"
echo ""

echo "Per testare dal vivo:"
echo "  ./ds4-agent"
echo "  Poi aspetta che il modello emetta 4 tool call identiche consecutive"
echo "  — oppure usa /power 1 per forzare risposte brevi e veloci —"
echo "  Quando la guardia scatta, vedrai il prompt e potrai scegliere."
echo ""
echo "=== Simulazione completata ==="
