# Integrazione chat DS4 Studio–OpenWiki: design del controller

## Obiettivo

Integrare nella chat DS4 Studio i comandi `/openwiki start`, `/openwiki analyze` e `/openwiki stop`, controllando un processo OpenWiki esterno tramite il suo protocollo HTTP locale. I due codebase rimangono indipendenti: DS4 Studio non importa, copia o compila codice OpenWiki.

## Requisiti approvati

- `/openwiki start path="/percorso/assoluto"` avvia OpenWiki e collega il target indicato.
- Il target non viene letto da configurazioni o variabili d'ambiente.
- `/openwiki analyze` genera o aggiorna `<target>/openwiki-doc/`.
- `/openwiki stop` annulla l'analisi, chiude stream/sessione e termina il processo OpenWiki avviato.
- I comandi funzionano anche quando la modalità agente DS4 non è attiva.
- L'analisi è asincrona e non blocca la chat.
- La chat mostra soltanto lifecycle, risultato ed errori sintetici.

## Non obiettivi

- Importare il package OpenWiki nel frontend/server DS4.
- Riutilizzare `AgentSessionManager` come runtime OpenWiki.
- Mostrare token, prompt o log completi dell'agente OpenWiki.
- Gestire più processi o target OpenWiki concorrenti.
- Accettare path relativi.

## Configurazione operativa

DS4 Studio deve conoscere come avviare il prodotto esterno senza conoscere il target. La configurazione OpenWiki contiene:

- path assoluto di `srun.sh` oppure comando equivalente;
- base URL locale del servizio, default `http://127.0.0.1:8787`;
- timeout di startup;
- URL/model ID del `ds4-server` da passare come parametri operativi a `srun.sh`.

Il repository target non compare in questa configurazione: arriva esclusivamente dal testo di `/openwiki start`.

## Parsing dei comandi

La grammatica ammessa è:

```text
/openwiki start path="/path/assoluto"
/openwiki analyze
/openwiki stop
```

Il parser:

- ignora spazi esterni;
- accetta virgolette doppie e path con spazi;
- rifiuta path assente, non quotato o relativo;
- rifiuta argomenti sconosciuti;
- non interpreta escape shell e non costruisce comandi concatenando input utente.

Il risultato è un oggetto tipizzato `{ type: "openwiki", action, path? }`, separato dalla logica React e dal controller server.

## OpenWikiController

Un modulo server dedicato possiede l'intero lifecycle:

```text
stopped -> starting -> attached -> analyzing -> attached
   ^           |          |            |
   +-----------+----------+------------+  stop/crash
```

Responsabilità:

1. avviare `srun.sh` con argomenti statici e configurati, mai con il target;
2. attendere `GET /health` entro il timeout;
3. inviare `POST /session/start` con il path ricevuto dal comando chat;
4. inviare `POST /analyze` e mantenere lo stream `GET /events`;
5. tradurre eventi OpenWiki in eventi DS4 Studio sintetici;
6. terminare l'intero process group su `stop`, timeout o shutdown DS4;
7. azzerare lo stato alla chiusura inattesa del processo.

Il controller usa dipendenze iniettate per `spawn`, `fetch`, timer e validazione del path, così i test non avviano processi reali.

## API DS4 Studio

### `POST /api/openwiki/start`

Body `{ "path": "/repo/target" }`. Avvia processo, attende health e collega sessione. Restituisce stato, path canonico e output directory.

### `POST /api/openwiki/analyze`

Avvia l'analisi e restituisce HTTP 202 con run ID e modalità.

### `POST /api/openwiki/stop`

È idempotente. Chiude stream, tenta la chiusura della sessione, invia `SIGTERM`, attende un periodo breve e usa `SIGKILL` solo se necessario.

### `GET /api/openwiki/status`

Restituisce lo stato osservato dal controller senza avviare processi.

### `GET /api/openwiki/events`

Proxy SSE degli eventi sintetici. Ogni client riceve lo stato corrente all'apertura; la chiusura del browser rimuove soltanto il listener e non arresta l'analisi.

## Integrazione chat

Il parser dei comandi intercetta `/openwiki` prima del normale invio al modello. Il componente applicativo chiama l'endpoint corrispondente e aggiunge messaggi `agentNotice` alla conversazione.

- `start`: “OpenWiki collegato a `<path>`; output `<path>/openwiki-doc`”.
- `analyze`: “Analisi OpenWiki avviata (`init|update`)”.
- completamento SSE: “Documentazione OpenWiki completata in `<output>`”.
- errore SSE: messaggio sintetico con causa e stato.
- `stop`: “OpenWiki arrestato”.

La connessione SSE rimane indipendente dalla richiesta chat, quindi l'utente può inviare `stop` durante una run.

## Macchina a stati ed errori

- `start` mentre il controller non è `stopped` restituisce HTTP 409.
- `analyze` richiede `attached`; una run concorrente restituisce HTTP 409.
- path invalido, runner mancante e timeout restituiscono errori distinti e azzerano il processo.
- errore di analisi lascia il processo `attached`, consentendo un retry.
- exit inatteso chiude SSE upstream, emette un errore e porta a `stopped`.
- `stop` da `stopped` restituisce successo senza side effect.

## Confine di sicurezza

- Il path target è un valore JSON inviato a OpenWiki, mai un argomento shell.
- Solo il path configurato di `srun.sh` viene eseguito.
- Il servizio remoto deve avere hostname loopback; URL non-loopback vengono rifiutati.
- Il controller non espone output stdout/stderr grezzo alla chat.
- DS4 Studio termina solo il processo figlio che ha creato.

## Strategia di test

- Test del parser per comandi validi, virgolette/spazi, path relativo, argomenti sconosciuti e input non OpenWiki.
- Test unitari del controller con processo e HTTP finti per start, timeout, crash, analyze, conflitto e stop idempotente.
- Test del parser SSE e della rimozione listener.
- Test endpoint Express con controller iniettato.
- Test UI/app logic che verifica intercettazione prima della chat agente e inserimento degli `agentNotice`.
- Test end-to-end server con un fake OpenWiki subprocess locale, senza modello reale.
- Suite `npm test`, build frontend e controllo sintassi dei moduli modificati.

## Compatibilità e rollout

- I comandi chat e le route esistenti non cambiano.
- Se OpenWiki non è configurato, `/openwiki start` restituisce un errore operativo esplicito.
- Il protocollo richiesto è OpenWiki service API v1; mismatch di versione impedisce l'attach.
- Nessun file OpenWiki viene aggiunto a DS4 Studio, eccetto la documentazione generata in `openwiki-doc/` quando l'utente esegue l'analisi.

## Criteri di accettazione

1. Il comando `start` con path assoluto avvia il processo esterno e collega quel target.
2. Il path non compare negli argomenti o nell'ambiente usato per avviare il processo.
3. `analyze` ritorna subito e la chat riceve completamento/errore via SSE.
4. `stop` è utilizzabile durante l'analisi e termina il processo posseduto.
5. Il normale loop agente DS4 non riceve i comandi `/openwiki`.
6. DS4 Studio non dipende da package o sorgenti OpenWiki.
