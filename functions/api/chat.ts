/**
 * POST /api/chat — Asistente de Bitcoin Sin Ruido.
 *
 * Cloudflare Pages Function que actúa de proxy seguro sobre la API de Gemini
 * (Google Generative Language). La clave nunca llega al navegador: vive como
 * secret del proyecto de Pages y solo se usa aquí, en el edge.
 *
 * Requisitos de configuración (Cloudflare Pages → Settings → Variables and
 * Secrets), tanto en Production como en Preview:
 *   - GEMINI_API_KEY  (secret, obligatorio)  · clave de Google AI Studio
 *   - GEMINI_MODEL    (variable, opcional)    · por defecto "gemini-flash-latest"
 *
 * La respuesta se transmite en streaming (SSE) para dar sensación de escritura
 * en vivo. Cada evento es `data: {"text":"..."}` y el cierre es `data: [DONE]`.
 */

interface Env {
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string; // alias aceptado por compatibilidad
  GEMINI_MODEL?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'model';
  content: string;
}

interface ChatRequest {
  messages?: ChatMessage[];
  page?: { url?: string; title?: string };
}

// Límites defensivos para evitar abuso y controlar coste/tokens.
const MAX_MESSAGES = 24;
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 24000;
// Alias "latest": apunta siempre al modelo Flash vigente, de modo que la web no
// se rompe cuando Google retira una versión concreta (p. ej. gemini-2.5-flash
// dejó de estar disponible para claves nuevas). Es un modelo con razonamiento
// interno ("thinking"); lo desactivamos abajo para respuestas rápidas y baratas.
const DEFAULT_MODEL = 'gemini-flash-latest';

// Dominios autorizados a usar el endpoint (protege contra hotlinking del proxy).
// Se permite el propio host de la request, el dominio de producción y las
// preview de Cloudflare Pages (*.pages.dev).
const ALLOWED_HOST_SUFFIXES = ['bitcoinsinruidos.com', 'pages.dev'];

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // same-origin fetches a veces omiten Origin
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const requestHost = new URL(request.url).host;
  if (host === requestHost) return true;
  const bareHost = host.split(':')[0];
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => bareHost === suffix || bareHost.endsWith(`.${suffix}`)
  );
}

/**
 * Instrucción de sistema: fija el rol, el tono de marca y la base de
 * conocimiento (mapa del sitio) para que el asistente responda con rigor y
 * derive a los artículos correctos.
 */
function buildSystemInstruction(page?: { url?: string; title?: string }): string {
  const context =
    page?.url || page?.title
      ? `\n\nCONTEXTO: el usuario está viendo la página "${page?.title ?? ''}" (${page?.url ?? ''}). Si su pregunta se relaciona con ella, tenlo en cuenta.`
      : '';

  return `Eres el asistente de **Bitcoin Sin Ruido** (bitcoinsinruidos.com), una web educativa en español sobre Bitcoin explicado desde el protocolo. Tu trabajo es resolver dudas de los visitantes sobre Bitcoin de forma clara, rigurosa y didáctica.

PRINCIPIOS (innegociables):
- Escribe SIEMPRE en español, claro y divulgativo, apto para principiantes pero técnicamente correcto.
- El lema de la marca es "protocolo, no precio". NUNCA des predicciones de precio, consejos de inversión, ni recomendaciones de compra/venta o de trading. Si te lo piden, explica amablemente que este sitio se centra en la tecnología y el protocolo, no en la especulación, y reconduce hacia el aspecto técnico.
- Básate en hechos contrastados (whitepaper de Bitcoin, BIPs, Bitcoin Optech, documentación técnica). Si no estás seguro de un dato, dilo con honestidad en vez de inventar. No inventes URLs ni cifras.
- Sé conciso: respuestas de 2-5 párrafos cortos o listas. Ve al grano. Usa Markdown ligero (negritas con **, listas con -, y enlaces [texto](url)).
- No pidas ni manejes datos sensibles. Nunca solicites claves privadas ni frases semilla; si el usuario las menciona, advierte de que jamás debe compartirlas con nadie.
- Mantente en el ámbito de Bitcoin y su tecnología. Si preguntan por otras criptomonedas, puedes comparar a nivel técnico, pero el foco es Bitcoin. Si la pregunta no tiene nada que ver con Bitcoin, redirige con amabilidad.

CÓMO ENLAZAR: cuando sea útil, remite al artículo relevante del sitio con un enlace Markdown. Usa EXCLUSIVAMENTE estas URLs reales (no inventes otras):

Guías pilar:
- Qué es Bitcoin y cómo funciona: https://bitcoinsinruidos.com/que-es-bitcoin/
- Cómo funciona la tecnología de Bitcoin: https://bitcoinsinruidos.com/articulos/bitcoin-como-tecnologia/
- Futuro de Bitcoin: https://bitcoinsinruidos.com/futuro-bitcoin/
- Cómo usar Bitcoin de forma segura: https://bitcoinsinruidos.com/articulos/como-usar-bitcoin-seguro/

Base:
- Historia de Bitcoin: https://bitcoinsinruidos.com/articulos/historia-de-bitcoin/
- Qué problema soluciona Bitcoin: https://bitcoinsinruidos.com/articulos/que-problema-soluciona-bitcoin/
- Por qué Bitcoin tiene valor: https://bitcoinsinruidos.com/articulos/por-que-bitcoin-tiene-valor/
- Qué significa descentralización: https://bitcoinsinruidos.com/articulos/descentralizacion-bitcoin/
- Bitcoin vs dinero tradicional: https://bitcoinsinruidos.com/articulos/bitcoin-vs-dinero-tradicional/
- Qué es la blockchain: https://bitcoinsinruidos.com/que-es-blockchain/
- Cómo funciona Bitcoin paso a paso: https://bitcoinsinruidos.com/como-funciona-bitcoin/

Tecnología:
- Qué es un bloque: https://bitcoinsinruidos.com/articulos/que-es-un-bloque-bitcoin/
- Qué es la minería: https://bitcoinsinruidos.com/articulos/mineria-de-bitcoin/
- Qué es el hash (SHA-256): https://bitcoinsinruidos.com/articulos/que-es-el-hash-bitcoin/
- Qué es la dificultad de minado: https://bitcoinsinruidos.com/articulos/dificultad-de-minado/
- Qué es el halving: https://bitcoinsinruidos.com/articulos/halving-bitcoin/
- Proof of Work: https://bitcoinsinruidos.com/articulos/proof-of-work/
- Qué son los nodos: https://bitcoinsinruidos.com/que-es-un-nodo-bitcoin/
- Qué es un UTXO: https://bitcoinsinruidos.com/utxo/
- Por qué hay 21 millones: https://bitcoinsinruidos.com/articulos/los-21-millones/

Escalabilidad y futuro:
- Qué es Lightning Network: https://bitcoinsinruidos.com/lightning-network/
- Ventajas y desventajas de Lightning: https://bitcoinsinruidos.com/articulos/ventajas-desventajas-lightning-network/
- Qué es Taproot: https://bitcoinsinruidos.com/taproot/
- Escalabilidad de Bitcoin: https://bitcoinsinruidos.com/escalabilidad-bitcoin/
- Problemas actuales de Bitcoin y soluciones: https://bitcoinsinruidos.com/articulos/problemas-actuales-de-bitcoin/
- BitVM y Citrea: https://bitcoinsinruidos.com/articulos/bitvm-y-citrea/
- Covenants: https://bitcoinsinruidos.com/articulos/covenants/
- BIP-360 y resistencia cuántica: https://bitcoinsinruidos.com/articulos/bip360-resistencia-cuantica/

Uso práctico y seguridad:
- Qué es una wallet de Bitcoin: https://bitcoinsinruidos.com/articulos/que-es-una-wallet-bitcoin/
- Tipos de wallets: https://bitcoinsinruidos.com/articulos/tipos-de-wallets-bitcoin/
- Cómo enviar y recibir Bitcoin: https://bitcoinsinruidos.com/articulos/como-enviar-y-recibir-bitcoin/
- Qué es una clave privada: https://bitcoinsinruidos.com/articulos/que-es-una-clave-privada/
- Errores comunes al usar Bitcoin: https://bitcoinsinruidos.com/articulos/errores-comunes-bitcoin/
- Cómo proteger tus Bitcoin: https://bitcoinsinruidos.com/articulos/como-proteger-tus-bitcoin/
- Comercios que aceptan Bitcoin (mapa en vivo): https://bitcoinsinruidos.com/comercios-que-aceptan-bitcoin/

Recursos:
- Todos los artículos: https://bitcoinsinruidos.com/articulos/
- Glosario: https://bitcoinsinruidos.com/glosario/
- Comparativas técnicas: https://bitcoinsinruidos.com/comparativas/
- Metodología editorial: https://bitcoinsinruidos.com/metodologia/

No cites la lista entera: enlaza solo 1-2 recursos realmente pertinentes a la pregunta.${context}`;
}

export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;

  if (!isAllowedOrigin(request)) {
    return jsonError('Origen no autorizado.', 403);
  }

  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonError(
      'El asistente no está configurado (falta GEMINI_API_KEY en el servidor).',
      503
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return jsonError('Cuerpo de la petición inválido (se esperaba JSON).');
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return jsonError('No se recibió ningún mensaje.');
  }
  if (messages.length > MAX_MESSAGES) {
    // Conserva solo los mensajes más recientes.
    messages.splice(0, messages.length - MAX_MESSAGES);
  }

  let totalChars = 0;
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    const text = m.content.trim().slice(0, MAX_CHARS_PER_MESSAGE);
    if (!text) continue;
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) break;
    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
    contents.push({ role, parts: [{ text }] });
  }

  if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
    return jsonError('La conversación debe terminar con un mensaje del usuario.');
  }

  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse`;

  const geminiPayload = {
    systemInstruction: {
      role: 'system',
      parts: [{ text: buildSystemInstruction(body.page) }],
    },
    contents,
    generationConfig: {
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 1024,
      // Desactiva el razonamiento interno: para un asistente de FAQ no aporta
      // calidad y consumiría el presupuesto de tokens (dejando la respuesta
      // vacía) además de encarecer y ralentizar cada llamada.
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiPayload),
    });
  } catch {
    return jsonError('No se pudo contactar con el servicio de IA.', 502);
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try {
      const errJson = (await upstream.json()) as { error?: { message?: string } };
      detail = errJson?.error?.message ? ` (${errJson.error.message})` : '';
    } catch {
      /* respuesta no-JSON */
    }
    return jsonError(`El servicio de IA devolvió un error${detail}.`, 502);
  }

  // Transforma la SSE de Gemini en una SSE simple para el cliente.
  const stream = transformGeminiStream(upstream.body);
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};

// Rechaza cualquier método que no sea POST.
export const onRequest = async (context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (context.request.method !== 'POST') {
    return jsonError('Método no permitido. Usa POST.', 405);
  }
  return context.next();
};

/**
 * Lee la SSE de Gemini (`data: {json}\n\n`), extrae el texto de cada fragmento
 * y reemite eventos `data: {"text":"..."}` seguidos de `data: [DONE]`.
 */
function transformGeminiStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const send = (controller: TransformStreamDefaultController<Uint8Array>, text: string) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
  };

  const processBuffer = (controller: TransformStreamDefaultController<Uint8Array>) => {
    // Los eventos SSE se separan por línea en blanco.
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      for (const line of rawEvent.split('\n')) {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const parts = parsed.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const p of parts) {
              if (typeof p.text === 'string' && p.text) send(controller, p.text);
            }
          }
        } catch {
          /* fragmento parcial o no-JSON: se ignora */
        }
      }
    }
  };

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      processBuffer(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      // Asegura un separador final por si el último evento no lo trae.
      if (buffer && !buffer.endsWith('\n\n')) buffer += '\n\n';
      processBuffer(controller);
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  return source.pipeThrough(transformer);
}
