# CMF — Matrice delle fonti

Stato al 24 ottobre 2026. Riferimenti: piano DS4-CMF v1.0, §2.2,
§50.1–50.9 e appendice A. Questa è una registrazione delle ispirazioni,
non una verifica delle licenze dei repository remoti né una SBOM completa.
Nessun accesso di rete effettuato. Le licenze sotto sono **dichiarate dal piano**;
LICENSE, NOTICE, copyright, tag e dipendenze transitive restano da verificare.

| Fonte | Repository dichiarato dal piano | Licenza dichiarata | Stato | SHA | Idea di riferimento |
|---|---|---|---|---|---|
| Hindsight | https://github.com/vectorize-io/hindsight | MIT | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | retain/recall/reflect, evidenze |
| EverOS | https://github.com/EverMind-AI/EverOS | Apache-2.0 | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | Markdown derivato, separazione episode/case/skill |
| SYNAPSE | https://github.com/hq0709/synapse | MIT | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | recupero associativo e limiti di propagazione |
| Graphiti | https://github.com/getzep/graphiti | Apache-2.0 | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | fatti temporali e provenienza |
| LightMem | https://github.com/zjunlp/LightMem | MIT | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | consolidamento differito |
| MemOS | https://github.com/MemTensor/MemOS | Apache-2.0 | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | livelli di memoria e verifica delle skill |
| Engram (TAIPANBOX) | https://github.com/TAIPANBOX/engram | Apache-2.0 | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | SQLite, scope, provenienza |
| Lux / Affective Episodic Memory | https://github.com/solidaxelproject/affective-episodic-memory | MIT | ISPIRAZIONE, nessun codice copiato | NOT_VERIFIED | salienza e priming limitato |

Per tutte le righe: tag = NOT_VERIFIED; file/snippet copiati nel componente
CMF = nessuno; copyright/NOTICE/transitive licenses = NOT_VERIFIED;
dipendenza runtime o vendor = nessuna; disabilitazione runtime = non applicabile.
Il componente ROCm `rocm-disk-only-engram` del repository DS4 non è TAIPANBOX/engram.
Questa dichiarazione riguarda il nuovo componente CMF, non tutto il repository DS4.

Prima di copiare codice o introdurre una dipendenza, il proprietario del ticket
deve sostituire NOT_VERIFIED con URL e revisione immutabile verificati, SPDX,
file e intervalli copiati, intestazioni copyright, LICENSE/NOTICE, dipendenze
transitive, uso previsto, test e procedura di disabilitazione. Serve review
incrociata; non basta la licenza riportata dal piano. Dataset e pesi dei modelli
hanno una verifica separata. Nessuno dei motori elencati è richiesto da M1.

M0-03 resta aperto per l'audit delle fonti remote. Il futuro inventario runtime
M1 deve registrare Python, SQLite effettivamente collegata, versioni e provenienza
dei pacchetti del sistema; l'assenza di pacchetti PyPI non equivale a SBOM vuota.
