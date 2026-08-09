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
 *   - GEMINI_MODEL    (variable, opcional)    · fuerza un modelo concreto; si no
 *     se define se usa la cascada FALLBACK_MODELS. Conviene dejarla SIN definir:
 *     un valor obsoleto ahí desactiva la cascada y vuelve a romper el chat.
 *
 * La respuesta se transmite en streaming (SSE) para dar sensación de escritura
 * en vivo. Cada evento es `data: {"text":"..."}` y el cierre es `data: [DONE]`.
 *
 * Diagnóstico en vivo:
 *   npx wrangler pages deployment tail <deployment-id> --project-name=bitcoinsinruido
 * Los eventos se emiten con prefijo `[chat]`.
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

/**
 * Modelos candidatos, en orden de preferencia. Se prueban en cascada: si uno
 * falla con un error recuperable (modelo retirado, argumento no soportado,
 * cuota de ese modelo agotada) se intenta el siguiente.
 *
 * POR QUÉ UNA LISTA Y NO UN ALIAS: hasta ahora se usaba el alias
 * `gemini-flash-latest`, que es un puntero móvil. Google lo movió a la familia
 * Gemini 3, que ya NO acepta `thinkingConfig.thinkingBudget`, y toda petición
 * empezó a fallar con 400 INVALID_ARGUMENT. Un alias móvil no protege de las
 * retiradas de Google: solo cambia el modo de romperse. Una cascada explícita
 * sí, porque degrada en vez de caerse.
 */
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash-lite',
];

// Tope de intentos contra la API: acota la latencia del peor caso.
const MAX_UPSTREAM_ATTEMPTS = 4;
// Tope de espera SOLO para la fase de cabeceras. Una vez empieza el streaming
// se cancela el temporizador, para no truncar respuestas largas.
const UPSTREAM_HEADERS_TIMEOUT_MS = 15000;

/**
 * Familias de "thinking" soportadas por cada modelo:
 *  - Gemini 2.5 usa `thinkingBudget` (0 = desactivado).
 *  - Gemini 3.x sustituyó ese campo por `thinkingLevel` y rechaza el anterior.
 * Si el modelo no encaja en ninguna familia conocida no se envía nada y se deja
 * el valor por defecto del modelo.
 */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (model.startsWith('gemini-2.5')) return { thinkingBudget: 0 };
  if (model.startsWith('gemini-3')) return { thinkingLevel: 'minimal' };
  return undefined;
}

// Dominios autorizados a usar el endpoint (protege contra hotlinking del proxy).
// Se permite el propio host de la request, el dominio de producción y las
// preview de Cloudflare Pages (*.pages.dev).
const ALLOWED_HOST_SUFFIXES = ['bitcoinsinruidos.com', 'pages.dev'];

/**
 * Códigos que Cloudflare INTERCEPTA en dominios de zona: sustituye el cuerpo de
 * la respuesta por su página genérica `error code: 502` en text/plain.
 *
 * Comprobado en producción: la misma Function devolvía el JSON correcto en
 * `bitcoinsinruido.pages.dev` y una página opaca en `bitcoinsinruidos.com`.
 * Por eso el widget solo podía enseñar su mensaje de fallback: el JSON con el
 * motivo real nunca llegaba al navegador. Nunca devolvemos estos códigos.
 */
const STATUS_MASKED_BY_CLOUDFLARE = new Set([502, 504]);

function jsonError(message: string, status = 400, extra?: Record<string, unknown>): Response {
  const safeStatus = STATUS_MASKED_BY_CLOUDFLARE.has(status) ? 503 : status;
  return new Response(JSON.stringify({ error: message, status: safeStatus, ...extra }), {
    status: safeStatus,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
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

  const systemInstruction = buildSystemInstruction(body.page);

  // Toda la fase de llamada a Gemini va envuelta: cualquier excepción
  // inesperada se convierte en un JSON útil, nunca en un 5xx opaco.
  try {
    const outcome = await callGeminiWithFallback(apiKey, env.GEMINI_MODEL, {
      systemInstruction,
      contents,
    });

    if (!outcome.ok) {
      console.error(
        '[chat] fallo upstream definitivo',
        JSON.stringify({ attempts: outcome.attempts })
      );
      return jsonError(outcome.message, outcome.status, { detail: outcome.detail });
    }

    console.log('[chat] ok', JSON.stringify({ model: outcome.model }));

    // Transforma la SSE de Gemini en una SSE simple para el cliente.
    const stream = transformGeminiStream(outcome.body);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        // OJO: no se envía `Connection: keep-alive`. Es una cabecera hop-by-hop
        // que el runtime de Workers gestiona por su cuenta; fijarla a mano no
        // aporta nada y ensucia la respuesta.
        'X-Accel-Buffering': 'no',
        'X-Chat-Model': outcome.model,
      },
    });
  } catch (err) {
    console.error('[chat] excepción no controlada', String(err));
    return jsonError('Error interno del asistente. Inténtalo de nuevo en unos minutos.', 500);
  }
};

/** Resultado de la cascada de intentos contra la API de Gemini. */
type GeminiOutcome =
  | { ok: true; model: string; body: ReadableStream<Uint8Array> }
  | { ok: false; status: number; message: string; detail: string; attempts: string[] };

/**
 * Llama a Gemini probando varios modelos/configuraciones hasta que uno responde.
 *
 * Motivo: Google retira modelos y cambia campos del payload sin previo aviso
 * (fue exactamente lo que tumbó el chat). En vez de depender de un único
 * identificador, se recorre una cascada y, ante un 400 por argumento no
 * soportado, se reintenta el mismo modelo sin `thinkingConfig`.
 */
async function callGeminiWithFallback(
  apiKey: string,
  configuredModel: string | undefined,
  payload: { systemInstruction: string; contents: Array<{ role: string; parts: Array<{ text: string }> }> }
): Promise<GeminiOutcome> {
  // El modelo configurado por variable de entorno manda; después, la cascada.
  const models: string[] = [];
  const configured = configuredModel?.trim();
  if (configured) models.push(configured);
  for (const m of FALLBACK_MODELS) if (!models.includes(m)) models.push(m);

  // Cada modelo se prueba con su thinkingConfig y, si procede, sin él.
  const plan: Array<{ model: string; thinking?: Record<string, unknown> }> = [];
  for (const model of models) {
    const thinking = thinkingConfigFor(model);
    plan.push({ model, thinking });
    if (thinking) plan.push({ model });
  }

  const attempts: string[] = [];
  let lastStatus = 503;
  let lastDetail = 'sin respuesta del servicio de IA';

  for (const step of plan.slice(0, MAX_UPSTREAM_ATTEMPTS)) {
    const result = await callGeminiOnce(apiKey, step.model, step.thinking, payload);

    if (result.ok) return { ok: true, model: step.model, body: result.body };

    lastStatus = result.status;
    lastDetail = result.detail;
    attempts.push(`${step.model}${step.thinking ? '+thinking' : ''} -> ${result.status}: ${result.detail}`);
    console.error(
      '[chat] intento fallido',
      JSON.stringify({ model: step.model, thinking: step.thinking ?? null, status: result.status, detail: result.detail })
    );

    // La clave es inválida o no tiene permisos: reintentar con otro modelo
    // no arregla nada y solo gasta tiempo y cuota.
    if (isApiKeyProblem(result.status, result.detail)) {
      return {
        ok: false,
        status: 503,
        message:
          'El asistente no está disponible: la clave de la API de IA no es válida o ha sido revocada.',
        detail: result.detail,
        attempts,
      };
    }
  }

  // Cuota agotada: mensaje específico, es la causa más habitual en tier gratuito.
  if (lastStatus === 429) {
    return {
      ok: false,
      status: 429,
      message:
        'El asistente ha alcanzado su límite de consultas por ahora. Inténtalo de nuevo en unos minutos.',
      detail: lastDetail,
      attempts,
    };
  }

  return {
    ok: false,
    status: 503,
    message: 'El asistente no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.',
    detail: lastDetail,
    attempts,
  };
}

function isApiKeyProblem(status: number, detail: string): boolean {
  const d = detail.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    d.includes('api key not valid') ||
    d.includes('api_key_invalid') ||
    d.includes('permission denied')
  );
}

/** Una única llamada a la API, con timeout en la fase de cabeceras. */
async function callGeminiOnce(
  apiKey: string,
  model: string,
  thinking: Record<string, unknown> | undefined,
  payload: { systemInstruction: string; contents: Array<{ role: string; parts: Array<{ text: string }> }> }
): Promise<
  | { ok: true; body: ReadableStream<Uint8Array> }
  | { ok: false; status: number; detail: string }
> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.6,
    topP: 0.95,
    maxOutputTokens: 1024,
  };
  // Se desactiva el razonamiento interno cuando el modelo lo permite: en un
  // asistente de FAQ no aporta calidad, encarece y puede agotar el presupuesto
  // de tokens dejando la respuesta vacía.
  if (thinking) generationConfig.thinkingConfig = thinking;

  const requestBody = JSON.stringify({
    systemInstruction: { role: 'system', parts: [{ text: payload.systemInstruction }] },
    contents: payload.contents,
    generationConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_HEADERS_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: requestBody,
      signal: controller.signal,
    });
  } catch (err) {
    return { ok: false, status: 504, detail: `no se pudo contactar con la API: ${String(err)}` };
  } finally {
    // Se limpia en cuanto llegan las cabeceras: el streaming posterior no debe
    // verse abortado por este temporizador.
    clearTimeout(timer);
  }

  if (!upstream.ok || !upstream.body) {
    return { ok: false, status: upstream.status, detail: await readUpstreamError(upstream) };
  }
  return { ok: true, body: upstream.body };
}

/** Extrae el motivo real del error de Gemini, sea JSON o texto plano. */
async function readUpstreamError(upstream: Response): Promise<string> {
  let raw = '';
  try {
    raw = await upstream.text();
  } catch {
    return `respuesta ilegible (HTTP ${upstream.status})`;
  }
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string; details?: unknown };
    };
    if (parsed?.error?.message) {
      const status = parsed.error.status ? ` [${parsed.error.status}]` : '';
      // `details` suele traer el campo concreto que Google rechaza: es justo
      // lo que faltaba para diagnosticar sin adivinar.
      const details = parsed.error.details ? ` ${JSON.stringify(parsed.error.details)}` : '';
      return `${parsed.error.message}${status}${details}`.slice(0, 500);
    }
  } catch {
    /* no era JSON */
  }
  return raw.slice(0, 500) || `HTTP ${upstream.status} sin cuerpo`;
}

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
  // Estado para poder explicar una respuesta vacía en vez de dejar la burbuja
  // en blanco (fallo silencioso que ya se dio al agotar el presupuesto de
  // tokens con los modelos "thinking").
  let sentAnyText = false;
  let finishReason = '';
  let blockReason = '';

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
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
              finishReason?: string;
            }>;
            promptFeedback?: { blockReason?: string };
          };
          const candidate = parsed.candidates?.[0];
          if (candidate?.finishReason) finishReason = candidate.finishReason;
          if (parsed.promptFeedback?.blockReason) blockReason = parsed.promptFeedback.blockReason;
          const parts = candidate?.content?.parts;
          if (parts) {
            for (const p of parts) {
              if (typeof p.text === 'string' && p.text) {
                sentAnyText = true;
                send(controller, p.text);
              }
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

      if (!sentAnyText) {
        console.error(
          '[chat] respuesta vacía',
          JSON.stringify({ finishReason, blockReason })
        );
        send(controller, emptyAnswerMessage(finishReason, blockReason));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  return source.pipeThrough(transformer);
}

/** Traduce el motivo técnico de una respuesta vacía a algo accionable. */
function emptyAnswerMessage(finishReason: string, blockReason: string): string {
  if (blockReason || finishReason === 'SAFETY') {
    return 'No puedo responder a eso: el filtro de contenido ha bloqueado la respuesta. Prueba a reformular la pregunta.';
  }
  if (finishReason === 'MAX_TOKENS') {
    return 'La respuesta se ha cortado por longitud. Prueba a hacer una pregunta más concreta.';
  }
  return 'No he obtenido respuesta del modelo. Prueba a reformular la pregunta en unos segundos.';
}
