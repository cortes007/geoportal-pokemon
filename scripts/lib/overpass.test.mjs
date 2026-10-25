import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENDPOINTS_POR_DEFECTO,
  ErrorOverpass,
  TIMEOUT_PETICION_MS,
  TIMEOUT_QL_S,
  USER_AGENT,
  crearClienteOverpass,
  describirError,
  endpointsConfigurados,
  esperaExponencialMs,
  interpretarEstado,
  leerRetryAfterMs,
  urlEstado,
} from './overpass.mjs';

const A = 'https://a.example/api/interpreter';
const B = 'https://b.example/api/interpreter';
const silencioso = { log() {}, warn() {}, error() {} };
const RESPUESTA_OK = { version: 0.6, elements: [{ type: 'node', id: 1, lat: 6.2, lon: -75.5 }] };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

function texto(cuerpo, status, headers = {}) {
  return new Response(cuerpo, { status, headers });
}

/** fetch simulado: consume respuestas en orden; un Error se lanza. */
function fetchSimulado(respuestas) {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url, init });
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    if (typeof siguiente === 'function') return siguiente(url, init);
    if (!siguiente) throw new Error(`fetch simulado sin respuesta para ${url}`);
    return siguiente;
  };
  fn.llamadas = llamadas;
  return fn;
}

function cliente(fetchFn, extra = {}) {
  const esperas = [];
  const c = crearClienteOverpass({
    fetchFn,
    esperarFn: async (ms) => {
      esperas.push(ms);
    },
    endpoints: [A],
    consultarEstadoAntes: false,
    log: silencioso,
    ...extra,
  });
  return { c, esperas };
}

test('502 y luego 200: espera 30 s, rota de endpoint y devuelve los datos', async () => {
  const fetchFn = fetchSimulado([
    texto('This Overpass API server is currently at capacity.', 502),
    json(RESPUESTA_OK),
  ]);
  const { c, esperas } = cliente(fetchFn, { endpoints: [A, B] });

  const resultado = await c.consultar('[out:json];node(1,2,3,4);out;');

  assert.deepEqual(esperas, [30_000]);
  assert.equal(resultado.intentos, 2);
  assert.equal(resultado.endpoint, B);
  assert.deepEqual(resultado.data, RESPUESTA_OK);
  assert.equal(fetchFn.llamadas[0].url, A);
  assert.equal(fetchFn.llamadas[1].url, B);
  assert.equal(fetchFn.llamadas[0].init.method, 'POST');
  assert.equal(
    fetchFn.llamadas[0].init.body,
    `data=${encodeURIComponent('[out:json];node(1,2,3,4);out;')}`,
  );
  assert.equal(fetchFn.llamadas[0].init.headers['User-Agent'], USER_AGENT);
});

test('con un solo endpoint no rota y la espera es exponencial con tope de 5 min', async () => {
  const fetchFn = fetchSimulado(Array.from({ length: 6 }, () => texto('busy', 503)));
  const { c, esperas } = cliente(fetchFn);

  await assert.rejects(c.consultar('q'), (error) => {
    assert.ok(error instanceof ErrorOverpass);
    assert.equal(error.estado, 503);
    assert.equal(error.cuerpo, 'busy');
    return true;
  });

  assert.equal(fetchFn.llamadas.length, 6);
  assert.ok(fetchFn.llamadas.every((llamada) => llamada.url === A));
  assert.deepEqual(esperas, [30_000, 60_000, 120_000, 240_000, 300_000]);
  assert.equal(esperaExponencialMs(9), 300_000);
});

test('Retry-After en segundos manda sobre la espera exponencial', async () => {
  const fetchFn = fetchSimulado([texto('slow down', 429, { 'Retry-After': '7' }), json(RESPUESTA_OK)]);
  const { c, esperas } = cliente(fetchFn);

  await c.consultar('q');
  assert.deepEqual(esperas, [7_000]);
});

test('leerRetryAfterMs entiende segundos y fecha HTTP', () => {
  const fecha = 'Wed, 21 Oct 2026 07:28:00 GMT';
  assert.equal(leerRetryAfterMs('120'), 120_000);
  assert.equal(leerRetryAfterMs(fecha, Date.parse(fecha) - 5_000), 5_000);
  assert.equal(leerRetryAfterMs(fecha, Date.parse(fecha) + 5_000), 0);
  assert.equal(leerRetryAfterMs('mañana'), null);
  assert.equal(leerRetryAfterMs(null), null);
});

test('HTTP 400 (consulta inválida) no se reintenta', async () => {
  const fetchFn = fetchSimulado([texto('Error: line 1: parse error', 400)]);
  const { c, esperas } = cliente(fetchFn);

  await assert.rejects(c.consultar('mala'), /HTTP 400|parse error/);
  assert.equal(fetchFn.llamadas.length, 1);
  assert.deepEqual(esperas, []);
});

test('error de red: se reintenta y el mensaje incluye error.cause (código y mensaje)', async () => {
  const causa = Object.assign(new Error('getaddrinfo ENOTFOUND a.example'), { code: 'ENOTFOUND' });
  const fetchFn = fetchSimulado([new TypeError('fetch failed', { cause: causa })]);
  const { c } = cliente(fetchFn, { intentos: 1 });

  await assert.rejects(c.consultar('q'), (error) => {
    const texto = describirError(error);
    assert.match(texto, /ENOTFOUND/);
    assert.match(texto, /getaddrinfo/);
    assert.match(texto, /HTTP: sin respuesta/);
    return true;
  });
});

test('HTTP 200 con remark de runtime error no se acepta y se reintenta', async () => {
  const parcial = { elements: [], remark: 'runtime error: Query timed out in "query" at line 3' };
  const fetchFn = fetchSimulado([json(parcial), json(RESPUESTA_OK)]);
  const { c, esperas } = cliente(fetchFn);

  const resultado = await c.consultar('q');
  assert.equal(resultado.intentos, 2);
  assert.deepEqual(esperas, [30_000]);
});

test('interpretarEstado lee cupos, espera y límite', () => {
  assert.deepEqual(interpretarEstado('Rate limit: 2\n2 slots available now.\n'), {
    sinLimite: false,
    cupos: 2,
    esperaS: null,
  });
  assert.deepEqual(
    interpretarEstado(
      'Rate limit: 2\nSlot available after: 2026-10-23T14:00:00Z, in 12 seconds.\nSlot available after: 2026-10-23T14:01:00Z, in 40 seconds.\n',
    ),
    { sinLimite: false, cupos: 0, esperaS: 12 },
  );
  assert.equal(interpretarEstado('Rate limit: 0\n').sinLimite, true);
  assert.equal(interpretarEstado('basura').cupos, null);
  assert.equal(urlEstado(A), 'https://a.example/api/status');
});

test('sin cupos en /api/status espera una sola vez por petición aunque el interpreter reintente', async () => {
  const fetchFn = fetchSimulado([
    texto('Rate limit: 2\nSlot available after: 2026-10-23T14:00:00Z, in 12 seconds.\n', 200),
    texto('busy', 502),
    json(RESPUESTA_OK),
  ]);
  const { c, esperas } = cliente(fetchFn, { endpoints: [A, B], consultarEstadoAntes: true });

  const resultado = await c.consultar('q');
  assert.equal(fetchFn.llamadas.length, 3);
  assert.equal(fetchFn.llamadas[0].url, 'https://a.example/api/status');
  assert.equal(fetchFn.llamadas[1].url, A);
  assert.equal(fetchFn.llamadas[2].url, B);
  assert.deepEqual(esperas, [13_000, 30_000]);
  assert.equal(resultado.intentosInterpreter, 2);
  assert.equal(resultado.fallosEstado, 0);
});

test('cualquier fallo de /api/status (timeout, 4xx, 5xx, red) se registra y envía el POST igual sin esperar', async () => {
  const errorTimeout = Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
  const casos = [
    { nombre: 'timeout', respuestaEstado: errorTimeout },
    { nombre: 'red', respuestaEstado: new TypeError('fetch failed') },
    { nombre: '404', respuestaEstado: texto('not found', 404) },
    { nombre: '429', respuestaEstado: texto('too many requests', 429) },
    { nombre: '502', respuestaEstado: texto('bad gateway', 502) },
    { nombre: '504', respuestaEstado: texto('gateway timeout', 504) },
  ];

  for (const caso of casos) {
    const avisos = [];
    const fetchFn = fetchSimulado([caso.respuestaEstado, json(RESPUESTA_OK)]);
    const { c, esperas } = cliente(fetchFn, {
      consultarEstadoAntes: true,
      log: {
        log() {},
        warn(msg) {
          avisos.push(msg);
        },
        error() {},
      },
    });

    const resultado = await c.consultar('q');
    assert.equal(resultado.intentos, 1, `intentos en caso ${caso.nombre}`);
    assert.equal(resultado.intentosInterpreter, 1, `intentosInterpreter en caso ${caso.nombre}`);
    assert.equal(resultado.fallosEstado, 1, `fallosEstado en caso ${caso.nombre}`);
    assert.deepEqual(esperas, [], `no debe esperar por estado en caso ${caso.nombre}`);
    assert.equal(fetchFn.llamadas.length, 2, `debe llegar a /api/interpreter en caso ${caso.nombre}`);
    assert.equal(fetchFn.llamadas[0].url, 'https://a.example/api/status');
    assert.equal(fetchFn.llamadas[1].url, A);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /\/api\/status no disponible; se envía igual/);
  }
});

test('cuando todos los intentos fallan, ErrorOverpass conserva intentosInterpreter y fallosEstado', async () => {
  const fetchFn = fetchSimulado([
    texto('status timeout', 504),
    texto('interpreter timeout', 504),
    texto('status timeout', 504),
    texto('interpreter timeout', 504),
  ]);
  const { c, esperas } = cliente(fetchFn, {
    endpoints: [A, B],
    intentos: 2,
    consultarEstadoAntes: true,
  });

  await assert.rejects(c.consultar('q'), (error) => {
    assert.ok(error instanceof ErrorOverpass);
    assert.equal(error.intentosInterpreter, 2);
    assert.equal(error.fallosEstado, 2);
    return true;
  });
  assert.deepEqual(esperas, [30_000]);
  assert.equal(fetchFn.llamadas.length, 4);
  assert.equal(fetchFn.llamadas[0].url, 'https://a.example/api/status');
  assert.equal(fetchFn.llamadas[1].url, A);
  assert.equal(fetchFn.llamadas[2].url, 'https://b.example/api/status');
  assert.equal(fetchFn.llamadas[3].url, B);
});

test('OVERPASS_URL reemplaza la lista y acepta varias URL separadas por coma', () => {
  assert.deepEqual(endpointsConfigurados({ OVERPASS_URL: ` ${A} , ${B},${A} ` }), [A, B]);
  assert.deepEqual(endpointsConfigurados({}), [...ENDPOINTS_POR_DEFECTO]);
  assert.deepEqual(endpointsConfigurados({ OVERPASS_URL: ' ' }), [...ENDPOINTS_POR_DEFECTO]);
  assert.equal(ENDPOINTS_POR_DEFECTO[0], 'https://overpass-api.de/api/interpreter');
  assert.ok(ENDPOINTS_POR_DEFECTO.every((url) => !url.includes('kumi.systems')));
});

test('User-Agent ASCII y timeouts coherentes', () => {
  assert.match(USER_AGENT, /^[\x20-\x7E]+$/);
  assert.ok(TIMEOUT_PETICION_MS >= 120_000);
  assert.ok(TIMEOUT_QL_S * 1000 <= TIMEOUT_PETICION_MS);
});
