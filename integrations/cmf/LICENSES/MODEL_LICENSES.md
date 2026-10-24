# CMF — Licenze di modelli e dataset

**M1: nessun modello usato.** Il nucleo standalone usa testo, hashing e SQLite
FTS5; non carica GGUF, embedding, reranker o LLM e non scarica pesi o tokenizer.
Nessun provider remoto o dataset di benchmark esterno è richiesto.
I test previsti usano fixture sintetiche locali, senza segreti reali.

Non sono quindi presenti voci modello/dataset da certificare per M1. Questo
non certifica i modelli già impiegati dall'applicazione DS4 e non chiude i gate
real-model del piano.

Prima di introdurre modelli o dataset in milestone successive registrare:
URL, revisione/hash immutabile, autore, licenza e condizioni effettive,
licenza del tokenizer e degli artefatti derivati, restrizioni d'uso/distribuzione,
provenienza dei dati, percorso locale, opt-in, test e procedura di rimozione.
La licenza del codice del provider non prova la licenza dei pesi o del dataset.
