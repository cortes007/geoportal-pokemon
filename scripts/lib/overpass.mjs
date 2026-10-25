/**
 * scripts/lib/overpass.mjs
 * ---------------------------------------------------------------------------
 * Cliente HTTP de Overpass API para los scripts de datos.
 *
 * Reglas (wiki OSM, "Public Overpass API instances", y decisión de la Fase 5A):
 *   - Una sola petición en vuelo: el cliente es secuencial por diseño.
 *   - User-Agent ASCII e identificable.
 *   - Antes de cada petición se consulta <base>/api/status; si responde y dice
 *     que no hay cupo, se espera una sola vez por petición. Si /api/status
 *     falla por cualquier motivo (timeout, 4xx, 5xx, red), se registra y se
 *     envía la petición a /api/interpreter igual.
 *   - Reintentos para HTTP 429/502/503/504, errores de red, timeouts y respuestas
 *     200 con `remark` de error. Respeta Retry-After; si no viene, espera
 *     exponencial 30 s → 60 → 120 → 240 → 300 s (tope). Mínimo 6 intentos.
 *   - Rota de endpoint entre intentos solo si hay más de uno configurado y se
 *     queda con el último que funcionó.
 *   - AbortSignal de 150 s por petición; las consultas usan [timeout:120].
 *
 * `fetch` y `esperar` se inyectan para probar sin red (scripts/lib/overpass.test.mjs).
 * No se usa durante --dry-run.
 * ---------------------------------------------------------------------------
 */

import { setDefaultResultOrder } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { resolve } from 'node:path';
import { RAIZ } from './env.mjs';
import { problemaRespuestaOverpass, remarkDeError } from './overpassRespuesta.mjs';

// Prefiere IPv4 cuando un dominio tiene registros AAAA y A para evitar timeouts en redes sin salida IPv6.
try {
  setDefaultResultOrder('ipv4first');
} catch {
  // Ignorar si el entorno no lo soporta.
}

/** Carpeta de caché local (ignorada por git). La comparte cargar-celdas.mjs. */
export const CACHE_DIR = resolve(RAIZ, 'scripts', '.overpass-cache');

/** Solo ASCII: identifica el proyecto y el propósito. */
export const USER_AGENT =
  'geoportal-pokemon-go/0.2 (carga local de terrenos OSM para Medellin; peticiones secuenciales)';

/**
 * Instancias públicas gratuitas y sin llave listadas hoy en la wiki de OSM.
 * overpass-api.de primero (instancia principal). overpass.kumi.systems se quitó:
 * la wiki indica que pasó a llamarse overpass.private.coffee.
 */
export const ENDPOINTS_POR_DEFECTO = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]);

export const CODIGOS_REINTENTABLES = Object.freeze([429, 502, 503, 504]);
export const TIMEOUT_PETICION_MS = 150_000;
/** Debe ser <= TIMEOUT_PETICION_MS / 1000 para que Overpass corte antes que el cliente. */
export const TIMEOUT_QL_S = 120;
export const TIMEOUT_ESTADO_MS = 10_000;
export const INTENTOS_POR_DEFECTO = 6;
export const ESPERA_BASE_MS = 30_000;
export const ESPERA_MAX_MS = 300_000;
/** Tope de cordura para un Retry-After absurdo (30 min). */
export const RETRY_AFTER_MAX_MS = 1_800_000;
const LARGO_CUERPO_ERROR = 200;

/** Espera asíncrona. */
export function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Endpoints a usar. `OVERPASS_URL` (una o varias URL separadas por coma)
 * REEMPLAZA la lista por defecto. Se lee de process.env: el script debe llamar
 * antes a cargarEnv() para que el valor del .env esté disponible.
 */
export function endpointsConfigurados(env = process.env) {
  const crudo = typeof env.OVERPASS_URL === 'string' ? env.OVERPASS_URL : '';
  const propios = crudo
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return propios.length > 0 ? [...new Set(propios)] : [...ENDPOINTS_POR_DEFECTO];
}

/** Indica si la lista viene de OVERPASS_URL. */
export function origenEndpoints(env = process.env) {
  return typeof env.OVERPASS_URL === 'string' && env.OVERPASS_URL.trim() !== ''
    ? 'OVERPASS_URL'
    : 'lista por defecto';
}

/** Solo los hosts, para imprimir sin exponer rutas (pueden llevar llaves de API). */
export function hostsDe(endpoints) {
  return endpoints
    .map((endpoint) => {
      try {
        return new URL(endpoint).host;
      } catch {
        return '(URL inválida)';
      }
    })
    .join(', ');
}

/** `<base>/api/interpreter` → `<base>/api/status`. */
export function urlEstado(endpoint) {
  return endpoint.replace(/\/interpreter\/?$/, '/status');
}

/** Espera exponencial del reintento N (1 = primer reintento): 30, 60, 120, 240, 300… s. */
export function esperaExponencialMs(numeroReintento) {
  const exponente = Math.max(0, numeroReintento - 1);
  return Math.min(ESPERA_BASE_MS * 2 ** exponente, ESPERA_MAX_MS);
}

/**
 * Interpreta la cabecera Retry-After (segundos o fecha HTTP).
 * @returns {number|null} milisegundos, o null si no viene o no se entiende.
 */
export function leerRetryAfterMs(valor, ahoraMs = Date.now()) {
  if (typeof valor !== 'string' || valor.trim() === '') return null;
  const texto = valor.trim();

  if (/^\d+$/.test(texto)) {
    return Math.min(Number(texto) * 1000, RETRY_AFTER_MAX_MS);
  }

  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return null;
  return Math.min(Math.max(0, fecha - ahoraMs), RETRY_AFTER_MAX_MS);
}

/**
 * Interpreta el texto de /api/status de Overpass.
 * Ejemplo:
 *   Rate limit: 2
 *   1 slots available now.
 *   Slot available after: 2026-10-23T14:00:00Z, in 12 seconds.
 * Cuando no hay cupo, la línea "slots available now" no aparece.
 * @returns {{ sinLimite: boolean, cupos: number|null, esperaS: number|null }}
 */
export function interpretarEstado(texto) {
  const contenido = typeof texto === 'string' ? texto : '';
  const limite = contenido.match(/Rate limit:\s*(\d+)/i);
  const libres = contenido.match(/(\d+)\s+slots?\s+available\s+now/i);
  const esperas = [...contenido.matchAll(/in\s+(-?\d+)\s+seconds?/gi)].map((m) => Number(m[1]));

  const sinLimite = limite !== null && Number(limite[1]) === 0;
  let cupos = null;
  if (libres) cupos = Number(libres[1]);
  else if (esperas.length > 0) cupos = 0;

  const esperaS = esperas.length > 0 ? Math.max(0, Math.min(...esperas)) : null;
  return { sinLimite, cupos, esperaS };
}

/** Error de Overpass con todo el contexto necesario para diagnosticar. */
export class ErrorOverpass extends Error {
  constructor(mensaje, detalle = {}) {
    super(mensaje, detalle.causa ? { cause: detalle.causa } : undefined);
    this.name = 'ErrorOverpass';
    this.endpoint = detalle.endpoint ?? null;
    this.estado = detalle.estado ?? null;
    this.codigo = detalle.codigo ?? null;
    this.causaMensaje = detalle.causaMensaje ?? null;
    this.cuerpo = detalle.cuerpo ?? '';
    this.reintentable = Boolean(detalle.reintentable);
    this.retryAfterMs = detalle.retryAfterMs ?? null;
    this.intentos = detalle.intentos ?? detalle.intentosInterpreter ?? 0;
    this.intentosInterpreter = detalle.intentosInterpreter ?? detalle.intentos ?? 0;
    this.fallosEstado = detalle.fallosEstado ?? 0;
  }
}

/** Texto de una línea con estado HTTP, causa (código y mensaje) y cuerpo truncado. */
export function describirError(error) {
  if (!(error instanceof ErrorOverpass)) {
    const causa = error?.cause;
    const extra = causa ? ` | causa: ${causa.code ?? 's/c'} ${causa.message ?? String(causa)}` : '';
    return `${error?.message ?? String(error)}${extra}`;
  }

  const partes = [error.message];
  partes.push(`HTTP: ${error.estado ?? 'sin respuesta'}`);
  if (error.codigo || error.causaMensaje) {
    partes.push(`causa: ${error.codigo ?? 's/c'} ${error.causaMensaje ?? ''}`.trim());
  }
  if (error.cuerpo) {
    partes.push(`cuerpo: ${error.cuerpo.replace(/\s+/g, ' ').slice(0, LARGO_CUERPO_ERROR)}`);
  }
  return partes.join(' | ');
}

/** Comprueba si el host de un endpoint resuelve por DNS. */
export async function comprobarDns(endpoint, lookupFn = lookup) {
  const host = new URL(endpoint).hostname;
  try {
    const direcciones = await lookupFn(host, { all: true });
    return { host, ok: true, direcciones: direcciones.map((d) => d.address) };
  } catch (error) {
    return { host, ok: false, codigo: error.code ?? null, mensaje: error.message };
  }
}

function errorDeRed(endpoint, error) {
  const esTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  return new ErrorOverpass(
    esTimeout ? `timeout de la petición en ${endpoint}` : `fallo de red en ${endpoint}`,
    {
      endpoint,
      codigo: error?.cause?.code ?? error?.name ?? null,
      causaMensaje: error?.cause?.message ?? error?.message ?? String(error),
      reintentable: true,
      causa: error,
    },
  );
}

/**
 * Crea un cliente Overpass secuencial.
 * @param {object} [opciones]
 * @param {typeof fetch} [opciones.fetchFn]
 * @param {(ms:number)=>Promise<void>} [opciones.esperarFn]
 * @param {string[]} [opciones.endpoints]
 * @param {number} [opciones.intentos=6]
 * @param {number} [opciones.timeoutMs=150000]
 * @param {boolean} [opciones.consultarEstadoAntes=true]
 * @param {() => number} [opciones.ahora]
 * @param {Pick<Console,'log'|'warn'>} [opciones.log]
 */
export function crearClienteOverpass({
  fetchFn = globalThis.fetch,
  esperarFn = esperar,
  endpoints = endpointsConfigurados(),
  intentos = INTENTOS_POR_DEFECTO,
  timeoutMs = TIMEOUT_PETICION_MS,
  timeoutEstadoMs = TIMEOUT_ESTADO_MS,
  consultarEstadoAntes = true,
  ahora = Date.now,
  log = console,
} = {}) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('No hay endpoints de Overpass configurados.');
  }

  let indiceActual = 0;
  let enVuelo = false;

  /** Lee /api/status. Lanza si falla (para el diagnóstico). */
  async function leerEstado(endpoint) {
    const url = urlEstado(endpoint);
    let respuesta;
    try {
      respuesta = await fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutEstadoMs),
      });
    } catch (error) {
      throw errorDeRed(url, error);
    }

    const texto = await respuesta.text().catch(() => '');
    if (!respuesta.ok) {
      throw new ErrorOverpass(`/api/status respondió HTTP ${respuesta.status} en ${url}`, {
        endpoint: url,
        estado: respuesta.status,
        cuerpo: texto.slice(0, LARGO_CUERPO_ERROR),
        reintentable: CODIGOS_REINTENTABLES.includes(respuesta.status),
        retryAfterMs: leerRetryAfterMs(respuesta.headers?.get?.('retry-after') ?? null, ahora()),
      });
    }
    return { estado: respuesta.status, texto, interpretado: interpretarEstado(texto) };
  }

  /**
   * Consulta /api/status y espera solo si responde 200 sin cupos libres.
   * Cualquier fallo de /api/status (timeout, 4xx, 5xx, red) se registra y NO
   * bloquea ni aborta el intento: el POST a /api/interpreter se envía igual.
   */
  async function esperarCupo(endpoint) {
    let estado;
    try {
      estado = (await leerEstado(endpoint)).interpretado;
    } catch (error) {
      log.warn(`[overpass] /api/status no disponible; se envía igual (${describirError(error)})`);
      return { ok: false, espero: false };
    }

    if (estado.sinLimite || estado.cupos === null || estado.cupos > 0) {
      return { ok: true, espero: false };
    }

    const esperaMs =
      estado.esperaS === null
        ? ESPERA_BASE_MS
        : Math.min((estado.esperaS + 1) * 1000, ESPERA_MAX_MS);
    log.log(`[overpass] sin cupos libres en ${endpoint}; esperando ${Math.round(esperaMs / 1000)} s`);
    await esperarFn(esperaMs);
    return { ok: true, espero: true };
  }

  /** Una sola petición POST, sin reintentos. Devuelve datos y texto crudo. */
  async function pedir(endpoint, query) {
    const inicio = ahora();
    let respuesta;
    try {
      respuesta = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw errorDeRed(endpoint, error);
    }

    let texto;
    try {
      texto = await respuesta.text();
    } catch (error) {
      throw errorDeRed(endpoint, error);
    }

    if (!respuesta.ok) {
      throw new ErrorOverpass(`Overpass respondió HTTP ${respuesta.status} en ${endpoint}`, {
        endpoint,
        estado: respuesta.status,
        cuerpo: texto.slice(0, LARGO_CUERPO_ERROR),
        reintentable: CODIGOS_REINTENTABLES.includes(respuesta.status),
        retryAfterMs: leerRetryAfterMs(respuesta.headers?.get?.('retry-after') ?? null, ahora()),
      });
    }

    let data;
    try {
      data = JSON.parse(texto);
    } catch {
      throw new ErrorOverpass(`Overpass devolvió algo que no es JSON en ${endpoint}`, {
        endpoint,
        estado: respuesta.status,
        cuerpo: texto.slice(0, LARGO_CUERPO_ERROR),
        reintentable: true,
      });
    }

    const remark = remarkDeError(data);
    if (remark) {
      throw new ErrorOverpass(`Overpass informó un error de ejecución en ${endpoint}`, {
        endpoint,
        estado: respuesta.status,
        cuerpo: remark.slice(0, LARGO_CUERPO_ERROR),
        reintentable: true,
      });
    }

    const problema = problemaRespuestaOverpass(data);
    if (problema) {
      throw new ErrorOverpass(`respuesta inesperada de ${endpoint}: ${problema}`, {
        endpoint,
        estado: respuesta.status,
        cuerpo: texto.slice(0, LARGO_CUERPO_ERROR),
      });
    }

    return { data, texto, estado: respuesta.status, ms: ahora() - inicio };
  }

  /**
   * Consulta con reintentos, espera exponencial y rotación de endpoint.
   * @returns {Promise<{ data: {elements: object[]}, endpoint: string, intentos: number, intentosInterpreter: number, fallosEstado: number }>}
   */
  async function consultar(query, { etiqueta = 'consulta' } = {}) {
    if (enVuelo) throw new Error('Ya hay una petición Overpass en vuelo; el cliente es secuencial.');
    enVuelo = true;

    try {
      let ultimoError = null;
      let intentosInterpreter = 0;
      let fallosEstado = 0;
      let yaEsperoEstado = false;

      for (let intento = 1; intento <= intentos; intento += 1) {
        const endpoint = endpoints[indiceActual];

        log.log(`[overpass] ${etiqueta}: intento ${intento}/${intentos} -> ${endpoint}`);
        try {
          if (consultarEstadoAntes && !yaEsperoEstado) {
            const estadoCupo = await esperarCupo(endpoint);
            if (!estadoCupo.ok) fallosEstado += 1;
            if (estadoCupo.espero) yaEsperoEstado = true;
          }
          intentosInterpreter += 1;
          const resultado = await pedir(endpoint, query);
          log.log(
            `[overpass] ${etiqueta}: ok, ${resultado.data.elements.length} elementos en ${resultado.ms} ms`,
          );
          return {
            data: resultado.data,
            endpoint,
            intentos: intentosInterpreter,
            intentosInterpreter,
            fallosEstado,
          };
        } catch (error) {
          ultimoError = error instanceof ErrorOverpass ? error : errorDeRed(endpoint, error);
          log.warn(`[overpass] ${etiqueta}: falló | ${describirError(ultimoError)}`);

          if (!ultimoError.reintentable || intento === intentos) break;

          if (endpoints.length > 1) indiceActual = (indiceActual + 1) % endpoints.length;
          const porCabecera = ultimoError.retryAfterMs !== null;
          const esperaMs = porCabecera ? ultimoError.retryAfterMs : esperaExponencialMs(intento);
          log.log(
            `[overpass] ${etiqueta}: esperando ${Math.round(esperaMs / 1000)} s (${porCabecera ? 'Retry-After' : 'exponencial'}) antes del intento ${intento + 1}`,
          );
          await esperarFn(esperaMs);
        }
      }

      throw new ErrorOverpass(
        `Overpass no respondió tras ${intentosInterpreter} intento(s): ${ultimoError?.message ?? 'sin detalle'}`,
        {
          endpoint: ultimoError?.endpoint,
          estado: ultimoError?.estado,
          codigo: ultimoError?.codigo,
          causaMensaje: ultimoError?.causaMensaje,
          cuerpo: ultimoError?.cuerpo,
          causa: ultimoError,
          intentos: intentosInterpreter,
          intentosInterpreter,
          fallosEstado,
        },
      );
    } finally {
      enVuelo = false;
    }
  }

  return { consultar, pedir, leerEstado, endpoints: [...endpoints] };
}
