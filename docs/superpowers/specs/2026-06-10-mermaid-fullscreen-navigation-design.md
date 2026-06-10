# Mermaid Fullscreen Navigation

## Obiettivo

Permettere di esplorare un diagramma Mermaid in fullscreen con zoom e
spostamento tramite mouse, riutilizzando l'SVG già renderizzato.

## Ingresso E Uscita

- Accanto al pulsante `Testo` viene aggiunto un pulsante `Fullscreen`.
- Il pulsante è disponibile quando il diagramma è stato renderizzato.
- L'apertura usa la Fullscreen API del browser.
- Se la Fullscreen API non è disponibile o viene rifiutata, l'interfaccia resta
  utilizzabile come overlay interno che occupa l'intera finestra.
- Il tasto `Esc`, il pulsante `×` o l'uscita fullscreen del browser chiudono la
  modalità di esplorazione.
- La chiusura ripristina lo scorrimento della pagina e non modifica la vista del
  diagramma nel messaggio.

## Navigazione

- Il trascinamento con il pulsante principale del mouse sposta il diagramma.
- La rotella esegue lo zoom mantenendo stabile il punto sotto il cursore.
- I pulsanti `−` e `+` applicano uno zoom incrementale centrato nel viewport.
- La scala è limitata tra 25% e 500%.
- Il pulsante `Adatta` calcola scala e posizione per contenere il diagramma nel
  viewport con un margine visivo.
- Un doppio click sul viewport equivale ad `Adatta`.
- All'apertura viene eseguito automaticamente `Adatta`.

## Interfaccia

La modalità fullscreen usa la palette flottante scelta nella variante B,
posizionata in basso a destra. La palette contiene:

- `−`;
- percentuale di zoom corrente;
- `+`;
- `Adatta`;
- `×`.

Un breve suggerimento in basso a sinistra ricorda trascinamento, rotella ed
uscita con `Esc`. Il cursore passa da `grab` a `grabbing` durante il pan.

## Architettura

Un componente React dedicato riceve la stringa SVG già prodotta da Mermaid.
L'SVG non viene rigenerato. Il componente gestisce:

- stato di apertura;
- elemento fullscreen;
- scala e traslazione;
- Pointer Events per il pan;
- evento `wheel` non passivo per lo zoom;
- sincronizzazione con `fullscreenchange`;
- blocco temporaneo dello scroll della pagina.

Le trasformazioni vengono applicate a un contenitore interno tramite
`translate(...) scale(...)`. Il calcolo `Adatta` usa le dimensioni intrinseche
dell'SVG e quelle del viewport.

## Accessibilità E Robustezza

- L'overlay usa `role="dialog"` e `aria-modal="true"`.
- I controlli hanno etichette accessibili.
- La palette è raggiungibile da tastiera.
- Il pulsante `Fullscreen` mantiene il focus al ritorno quando possibile.
- Gli errori della Fullscreen API attivano il fallback overlay senza interrompere
  la navigazione.
- La modalità non è disponibile durante `generating`, `pending`, errore o vista
  sorgente.

## Test

- Il pulsante fullscreen appare solo con SVG pronto e vista diagramma.
- L'apertura usa la Fullscreen API quando disponibile e il fallback in caso di
  errore.
- `+`, `−`, rotella e pan aggiornano la trasformazione entro i limiti previsti.
- `Adatta` e doppio click ripristinano una vista contenuta.
- `Esc`, `×` e `fullscreenchange` chiudono correttamente.
- Uno smoke test browser verifica apertura, zoom, pan, reset e chiusura.
