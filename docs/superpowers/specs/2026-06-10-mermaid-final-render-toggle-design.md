# Mermaid Final Render And Source Toggle

## Obiettivo

Eliminare lo sfarfallio dei diagrammi Mermaid durante lo streaming e permettere
all'utente di alternare la visualizzazione renderizzata con il sorgente Mermaid.

## Comportamento

- Un fence Mermaid privo della chiusura finale non avvia JavaScript Mermaid.
- Durante questa fase il frontend mostra un riquadro stabile con il testo
  `Diagramma in generazione...`.
- Quando viene ricevuto il fence di chiusura, il diagramma viene renderizzato una
  sola volta usando il sorgente completo.
- Un piccolo pulsante in basso a destra mostra `Testo` quando è visibile il
  diagramma e `Diagramma` quando è visibile il sorgente.
- Il pulsante alterna localmente le due viste senza modificare il messaggio.
- Il pulsante espone lo stato tramite `aria-pressed` e una descrizione accessibile.
- Se Mermaid restituisce un errore, il riquadro mostra l'errore e il sorgente.

## Architettura

`MessageContent` determina quali fence Mermaid sono completi prima di passare il
contenuto a `ReactMarkdown`. Il componente del blocco riceve sia il sorgente sia
un flag di completezza:

- `complete: false`: mostra soltanto lo stato di generazione;
- `complete: true`: avvia il singolo rendering Mermaid;
- rendering riuscito: mostra SVG e toggle;
- rendering fallito: mostra errore e sorgente.

La precedente coda di rendering progressivo viene rimossa perché non serve più:
la chiusura del fence è il segnale deterministico che abilita il rendering.

## Presentazione

Il riquadro Mermaid mantiene lo stile esistente. Il contenuto lascia spazio in
basso al controllo, posizionato in basso a destra. Il pulsante è compatto ma
mantiene un'area cliccabile e un contrasto coerenti con gli altri controlli del
frontend. Il sorgente usa il font monospaziato già adottato dai blocchi di codice.

## Test

- Un fence Mermaid incompleto mostra `Diagramma in generazione...` e non entra
  nello stato di rendering.
- Un fence completo entra nello stato di rendering.
- Il rilevamento funziona anche con testo Markdown prima e dopo il diagramma.
- Il toggle espone le etichette e lo stato accessibile previsti.
- La suite frontend e il build Vite devono continuare a passare.
- Uno smoke test nel browser verifica il passaggio diagramma/testo/diagramma.
