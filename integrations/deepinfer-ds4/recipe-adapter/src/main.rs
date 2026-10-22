// Part of DS4-Studio DeepInfer integration (plan §5, PR-05).
//! JSON-lines protocol adapter over deepseek-recipe (plan §5.1).
//!
//! One request per stdin line, one response per stdout line. Two operations:
//! - `encode`: Chat Completions request -> rendered DeepSeek prompt plus the byte
//!   ranges of its explicit special tokens. Token IDs are never produced: the DS4
//!   GGUF tokenizer stays the only tokenizer owner.
//! - `parse`: Chat Completions request + backend output text chunks -> protocol
//!   chunks from recipe's `StreamProcessor`.
//!
//! No network, no files, no images: the image crate is not a dependency and any
//! request that renders an image placeholder is rejected.

use std::io::{self, BufRead, Write};

use deepseek_recipe::openai::ChatCompletionRequest;
use deepseek_recipe::request::{ConversationRequest, ConversionOptions, ModelVersion, ProtocolRequest};
use deepseek_recipe::stream::{InferenceChunk, InferenceFinishReason, StreamProcessor};
use deepseek_recipe_encoding::dsv4::DeepseekV4Encoding;
use deepseek_recipe_encoding::dsv41::DeepseekV41Encoding;
use deepseek_recipe_encoding::{PromptEncoding, RenderedPrompt};
use serde_json::{Value, json};
use tokio_stream::StreamExt;

const PROTOCOL_VERSION: u64 = 1;
const MAX_LINE_BYTES: usize = 16 << 20;
const MAX_OUTPUT_CHUNKS: usize = 1 << 16;
pub const RECIPE_COMMIT: &str = "935817c66f5d6e64838f419692545f06787e485f";

/// Only DeepSeek families have a recipe; anything else stays on the legacy path.
fn family_version(family: &str) -> Option<ModelVersion> {
    match family {
        "deepseek-v4" => Some(ModelVersion::DeepseekV4Pro),
        "deepseek-v4.1" => Some(ModelVersion::DeepseekV41Flash),
        _ => None,
    }
}

fn convert(family: &str, request: &Value) -> Result<ConversationRequest, String> {
    let version = family_version(family).ok_or_else(|| format!("no recipe for model_family {family:?}"))?;
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .ok_or("request.model must be a string")?
        .to_string();
    let parsed: ChatCompletionRequest =
        serde_json::from_value(request.clone()).map_err(|e| format!("invalid request: {e}"))?;
    // The family decides the template; the request's model name is only an alias.
    let converted = parsed
        .convert(ConversionOptions::new().with_model_alias(model, version))
        .map_err(|e| e.to_string())?;
    if converted.model_version != version {
        return Err("model version does not match model_family".into());
    }
    Ok(converted)
}

fn render(converted: &ConversationRequest) -> RenderedPrompt {
    match converted.model_version {
        ModelVersion::DeepseekV41Flash => DeepseekV41Encoding::new().render_conversation(&converted.conversation),
        _ => DeepseekV4Encoding::new().render_conversation(&converted.conversation),
    }
}

fn encode(family: &str, request: &Value) -> Result<Value, String> {
    let converted = convert(family, request)?;
    let rendered = render(&converted);
    if !rendered.image_sources.is_empty() {
        return Err("image input is not supported by the adapter".into());
    }
    let ranges: Vec<[usize; 2]> = rendered.special_ranges.iter().map(|r| [r.start, r.end]).collect();
    let opts = &converted.inference_options;
    Ok(json!({
        "prompt": rendered.prompt,
        "special_ranges": ranges,
        "metadata": {
            "template_id": family,
            "token_ids_available": false,
            "recipe_commit": RECIPE_COMMIT,
            "thinking_mode": converted.conversation.thinking_mode,
            "max_tokens": opts.max_tokens,
            "temperature": opts.temperature,
            "top_p": opts.top_p,
            "output_constraint": opts.output_constraint.as_ref().map(|c| c.kind()),
        },
    }))
}

fn finish_reason(name: &str) -> Result<InferenceFinishReason, String> {
    match name {
        "stop" => Ok(InferenceFinishReason::Stop),
        "length" => Ok(InferenceFinishReason::Length),
        "content_filter" => Ok(InferenceFinishReason::ContentFilter),
        _ => Err(format!("unknown finish reason {name:?}")),
    }
}

fn parse(family: &str, request: &Value, msg: &Value) -> Result<Value, String> {
    let converted = convert(family, request)?;
    let texts = msg
        .get("output")
        .and_then(Value::as_array)
        .ok_or("output must be an array of strings")?;
    if texts.len() > MAX_OUTPUT_CHUNKS {
        return Err("too many output chunks".into());
    }
    let mut inference = Vec::with_capacity(texts.len() + 1);
    for t in texts {
        let content = t.as_str().ok_or("output must be an array of strings")?.to_string();
        inference.push(InferenceChunk::Text { content, token_count: 1 });
    }
    // A missing finish models a cancelled stream: no Finish chunk reaches the processor.
    if let Some(f) = msg.get("finish").filter(|f| !f.is_null()) {
        let name = f.as_str().ok_or("finish must be a string or null")?;
        inference.push(InferenceChunk::Finish { finish_reason: finish_reason(name)? });
    }
    let generator = ChatCompletionRequest::chunk_generator(&converted, "ds4di".into(), "ds4di".into());
    let processor = StreamProcessor::new(generator, converted.parsing_options);
    let chunks = futures::executor::block_on(async {
        let stream = processor.into_protocol_stream(tokio_stream::iter(inference));
        let mut stream = std::pin::pin!(stream);
        let mut out = Vec::new();
        while let Some(chunk) = stream.next().await {
            let mut v = serde_json::to_value(chunk.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            // Wall-clock field; dropped so the output is a pure function of the input.
            if let Some(o) = v.as_object_mut() {
                o.remove("created");
            }
            out.push(v);
        }
        Ok::<_, String>(out)
    })?;
    let raw: String = texts.iter().filter_map(Value::as_str).collect();
    let (authorized, rejected) = authorize_tool_calls(family, request, &raw, &chunks);
    Ok(json!({
        "chunks": chunks,
        "authorized_tool_calls": authorized,
        "rejected_tool_calls": rejected,
    }))
}

fn tool_block_tags(family: &str) -> (&'static str, &'static str) {
    if family == "deepseek-v4.1" {
        ("<｜DSML｜ calls>", "</｜DSML｜ calls>")
    } else {
        ("<｜DSML｜tool_calls>", "</｜DSML｜tool_calls>")
    }
}

/// Recipe streams whatever tool call the text spells, including undeclared tool
/// names and blocks the model never closed. A call is authorized here only when
/// the stream finished with `tool_calls`, every opened DSML block was closed,
/// the name is declared in the request, and the arguments are a JSON object.
fn authorize_tool_calls(family: &str, request: &Value, raw: &str, chunks: &[Value]) -> (Vec<Value>, Vec<Value>) {
    let declared: Vec<&str> = request
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|t| t.pointer("/function/name").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    let mut calls: Vec<(String, String)> = Vec::new();
    let mut finish = None;
    for chunk in chunks {
        let Some(choice) = chunk.pointer("/choices/0") else { continue };
        if let Some(f) = choice.get("finish_reason").and_then(Value::as_str) {
            finish = Some(f.to_string());
        }
        for tc in choice.pointer("/delta/tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let Some(index) = tc.get("index").and_then(Value::as_u64) else { continue };
            let index = index as usize;
            if index >= calls.len() {
                calls.resize(index + 1, (String::new(), String::new()));
            }
            if let Some(name) = tc.pointer("/function/name").and_then(Value::as_str) {
                calls[index].0.push_str(name);
            }
            if let Some(args) = tc.pointer("/function/arguments").and_then(Value::as_str) {
                calls[index].1.push_str(args);
            }
        }
    }
    let (open, close) = tool_block_tags(family);
    let closed = raw.matches(open).count() == raw.matches(close).count();
    let mut authorized = Vec::new();
    let mut rejected = Vec::new();
    for (index, (name, args)) in calls.into_iter().enumerate() {
        let reason = if finish.as_deref() != Some("tool_calls") {
            Some("stream did not finish with tool_calls")
        } else if !closed {
            Some("tool call block not closed")
        } else if !declared.contains(&name.as_str()) {
            Some("tool not declared in request")
        } else if !serde_json::from_str::<Value>(&args).is_ok_and(|v| v.is_object()) {
            Some("arguments are not a JSON object")
        } else {
            None
        };
        match reason {
            None => authorized.push(json!({"index": index, "name": name, "arguments": args})),
            Some(reason) => rejected.push(json!({"index": index, "name": name, "reason": reason})),
        }
    }
    (authorized, rejected)
}

fn handle(line: &str) -> Value {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return json!({"v": PROTOCOL_VERSION, "id": null, "ok": false, "error": format!("invalid JSON: {e}")}),
    };
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let result = (|| {
        if msg.get("v").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            return Err("unsupported protocol version".to_string());
        }
        let family = msg.get("model_family").and_then(Value::as_str).ok_or("model_family must be a string")?;
        let request = msg.get("request").filter(|r| r.is_object()).ok_or("request must be an object")?;
        match msg.get("op").and_then(Value::as_str) {
            Some("encode") => encode(family, request),
            Some("parse") => parse(family, request, &msg),
            _ => Err("op must be encode or parse".to_string()),
        }
    })();
    match result {
        Ok(Value::Object(mut body)) => {
            body.insert("v".into(), json!(PROTOCOL_VERSION));
            body.insert("id".into(), id);
            body.insert("ok".into(), json!(true));
            Value::Object(body)
        }
        Ok(_) => unreachable!("handlers return objects"),
        Err(error) => json!({"v": PROTOCOL_VERSION, "id": id, "ok": false, "error": error}),
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut out = io::stdout().lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        // Bounded read: a line over the limit is consumed and rejected, never buffered whole.
        let mut total = 0usize;
        let mut overflow = false;
        loop {
            let chunk = reader.fill_buf()?;
            if chunk.is_empty() {
                break;
            }
            let (take, done) = match chunk.iter().position(|&b| b == b'\n') {
                Some(i) => (i + 1, true),
                None => (chunk.len(), false),
            };
            total += take;
            if total > MAX_LINE_BYTES {
                overflow = true;
            } else {
                buf.extend_from_slice(&chunk[..take]);
            }
            reader.consume(take);
            if done {
                break;
            }
        }
        if total == 0 {
            return Ok(());
        }
        let resp = if overflow {
            json!({"v": PROTOCOL_VERSION, "id": null, "ok": false, "error": "line exceeds limit"})
        } else {
            match std::str::from_utf8(&buf) {
                Ok(s) if s.trim().is_empty() => continue,
                Ok(s) => handle(s.trim_end_matches(['\n', '\r'])),
                Err(_) => json!({"v": PROTOCOL_VERSION, "id": null, "ok": false, "error": "line is not UTF-8"}),
            }
        };
        serde_json::to_writer(&mut out, &resp)?;
        out.write_all(b"\n")?;
        out.flush()?;
    }
}
