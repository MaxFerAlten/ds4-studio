# Parità Dei Comandi Nativi Agent

## Obiettivo

Quando DS4 Studio entra in modalità agentica tramite `/agent start`, la chat
deve accettare lo stesso insieme di slash command disponibili nel terminale
`ds4-agent`, senza inviarli al modello:

```text
/help
/save
/compact
/list
/switch SHA
/del SHA
/strip SHA
/history [N]
/power N
/new
/quit
/exit
```

I comandi di controllo di DS4 Studio restano disponibili come
`/agent start`, `/agent stop` e `/agent status`. Per compatibilità, anche la
forma `/agent <comando-nativo>` viene accettata e tradotta nel comando nativo
equivalente.

## Semantica

- `/help` mostra in chat i comandi disponibili e la relativa sintassi.
- `/save` salva la sessione corrente e restituisce SHA e numero di token.
- `/compact` compatta il contesto corrente.
- `/list` restituisce le sessioni salvate, ordinate e descritte come nel runtime
  nativo.
- `/switch SHA` salva prima la sessione corrente se è stata modificata, carica
  la sessione indicata e restituisce anche la cronologia recente.
- `/del SHA` elimina la sessione salvata corrispondente a un prefisso SHA non
  ambiguo.
- `/strip SHA` rimuove il payload KV mantenendo il testo necessario alla
  ricostruzione.
- `/history [N]` mostra gli ultimi `N` turni utente, usando gli stessi limiti e
  il valore predefinito di `ds4-agent`.
- `/power N` imposta il duty cycle GPU tra 1 e 100.
- `/new` salva prima la sessione corrente se necessario e riparte dal system
  prompt.
- `/quit` e `/exit` salvano la sessione corrente se necessario, fermano la
  modalità agentica e riportano il wrapper in modalità server. DS4 Studio e il
  processo wrapper restano aperti.

Le operazioni che abbandonano la sessione corrente (`/switch`, `/new`, `/quit`
e `/exit`) sono transazionali rispetto al salvataggio: se il salvataggio
automatico fallisce, il comando fallisce, la modalità e la sessione corrente
non cambiano.

I comandi inviati mentre il frontend consente una nuova richiesta seguono le
regole di stato del runtime nativo. Le scorciatoie e il multiplexing propri del
terminale (`Ctrl+C`, `Ctrl+D`, `Ctrl+X`, prompt accodati ed editor linenoise)
non fanno parte dell'interfaccia web.

## Architettura

### Runtime C

`ds4_agent_runtime` espone un dispatcher unico che riceve il comando completo,
lo valida con la stessa grammatica del terminale e richiama direttamente le
funzioni native di sessione, cronologia, compattazione e potenza.

Il dispatcher restituisce un risultato strutturato contenente:

- esito e codice errore;
- nome canonico del comando;
- messaggio leggibile;
- eventuali dati strutturati;
- eventuale azione richiesta al wrapper, come il ritorno alla modalità server.

La logica condivisa rimane nel runtime C, evitando una seconda implementazione
della semantica in React o Node.

### Wrapper HTTP

Il wrapper aggiunge `POST /api/native-agent/command`, con un corpo JSON del
tipo:

```json
{"command":"/history 10"}
```

L'endpoint esegue il dispatcher solo in modalità agentica. Per `/quit` e
`/exit`, il dispatcher completa prima il salvataggio; il livello HTTP rilascia
la richiesta agentica e solo dopo effettua il passaggio atomico alla modalità
server, evitando di cambiare modalità mentre il wrapper risulta occupato.

Gli endpoint nativi esistenti restano disponibili per compatibilità e delegano
alla stessa logica centrale.

### Server Node

DS4 Studio espone lo stesso endpoint sotto `/api/native-agent/command` e inoltra
al wrapper comando, stato HTTP, content type e risposta.

L'intercettazione degli slash command dentro `/api/agent/chat` non restituisce
più JSON a un client che sta leggendo SSE. Per compatibilità con client meno
recenti, il server invoca il dispatcher comune e converte il risultato in
eventi `agent_text`, `agent_error` e `agent_done` coerenti. Il frontend
principale non dipende da questo percorso perché intercetta i comandi prima di
aprire lo stream di chat.

### Frontend

Un parser puro riconosce:

- i comandi nativi quando `agentMode` è attivo;
- gli alias `/agent <comando-nativo>`;
- i comandi di controllo `/agent start|stop|status`.

I comandi nativi vengono inviati al dispatcher HTTP e il risultato viene
mostrato come messaggio di servizio nella chat. Non viene aggiunto un messaggio
assistant vuoto e non parte alcuna generazione.

Dopo `/quit`, `/exit` o `/agent stop`, lo stato locale `agentMode` viene
sincronizzato con la risposta del server. Gli alias già esistenti
(`/agent save`, `/agent list`, `/agent new`, `/agent compact`,
`/agent switch` e `/agent strip`) restano validi; la stessa forma
`/agent <comando>` viene estesa agli altri comandi nativi.

## Errori E Validazione

- Un comando sconosciuto iniziato con `/` resta testo normale solo fuori dalla
  modalità agentica; in modalità agentica produce un errore di comando
  sconosciuto e non raggiunge il modello.
- Gli argomenti mancanti o non validi restituiscono una sintassi d'uso chiara.
- I prefissi SHA inesistenti o ambigui non modificano sessioni o file.
- `/history` applica gli stessi limiti numerici del runtime nativo.
- `/power` accetta solo interi tra 1 e 100.
- I comandi non supportati quando il wrapper non è attivo restituiscono un
  errore esplicito.
- Errori HTTP, JSON non valido e fallimenti del runtime vengono visualizzati in
  chat senza alterare lo stato agentico, salvo una risposta esplicita che
  confermi il passaggio alla modalità server.

## Test

### Runtime E Wrapper

- Il parser riconosce tutti i comandi nativi e rifiuta sintassi non valide.
- Ogni comando richiama la funzione runtime corretta e restituisce un risultato
  strutturato.
- `/switch`, `/new`, `/quit` e `/exit` non cambiano stato se il salvataggio
  automatico fallisce.
- `/quit` e `/exit` passano alla modalità server solo dopo aver rilasciato la
  richiesta agentica.
- `/history`, `/power` e `/del` coprono casi validi, mancanti, fuori limite,
  inesistenti e ambigui.

### Server Node

- Il proxy inoltra metodo, corpo, stato e risposta.
- Uno slash command non viene più restituito come JSON grezzo attraverso una
  risposta attesa come SSE.
- Il wrapper disabilitato produce un errore esplicito.

### Frontend

- Dopo `/agent start`, tutti i comandi nativi vengono intercettati e non
  raggiungono `sendAgentMessage`.
- Gli alias `/agent ...` producono lo stesso comando canonico.
- Fuori dalla modalità agentica i comandi nativi non vengono intercettati.
- `/quit` e `/exit` disattivano il badge agent solo dopo conferma del server.
- Successi ed errori vengono mostrati senza creare messaggi assistant vuoti.
