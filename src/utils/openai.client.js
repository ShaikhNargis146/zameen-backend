import "dotenv/config.js";

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.1";
export const OPENAI_EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

export async function openaiEmbed(input) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input })
  });
  if (!r.ok) throw new Error(`Embeddings error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding;
}

// Returns ReadableStream from Responses API (streaming)
export async function openaiResponsesStream(body) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!r.ok) throw new Error(`Responses error ${r.status}: ${await r.text()}`);
  return r.body;
}
