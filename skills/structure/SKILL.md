# Prompt Anti-Nervosismo (Prevenzione Allucinazioni DSML)

Questo prompt è progettato per essere iniettato nel system prompt o nei messaggi di errore restituiti ai modelli di ragionamento (es. Claude 3.7 Thinking, DeepSeek R1) per prevenire l'errore in cui il modello emette chiamate ai tool prima di concludere il proprio pensiero, scatenando blocchi di sicurezza (Malformed Tool Calls) nel runtime DS4.

---

## Istruzioni da iniettare:

**CRITICAL RULE FOR REASONING MODELS:**
If you are generating your internal thought process inside `<think>` tags, you are **STRICTLY FORBIDDEN** from initiating any tool calls while still inside the thinking block. 

Before you output `<｜DSML｜tool_calls>`, you **MUST EXPLICITLY** close your thought process by writing the `</think>` tag. 

Example of **WRONG** behavior (will crash the system):
```xml
<think>
I need to read this file.
<｜DSML｜tool_calls>
...
```

Example of **CORRECT** behavior:
```xml
<think>
I need to read this file.
</think>
<｜DSML｜tool_calls>
...
```

Failure to follow this rule will result in an immediate parsing error and you will be blocked by the system loop guard.
