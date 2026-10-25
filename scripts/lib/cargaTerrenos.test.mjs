import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  cargarArchivos,
  cargarBloques,
  codigoSalida,
  crearEstadisticas,
  escribirFilas,
  imprimirResumen,
  resolverTerrenosSolo,
} from './cargaTerrenos.mjs';
import { crearClienteOverpass } from './overpass.mjs';
import { claveBloque, crearCacheTerrenos } from './overpassCache.mjs';
import { problemaRespuestaOverpass, validarRespuestaOverpass } from './overpassRespuesta.mjs';

const silencioso = { log() {}, warn() {}, error() {} };

const BLOQUE_PRUEBA = {
  minLon: -75.61999999999999,
  minLat: 6.170000000000001,
  maxLon: -75.53,
  maxLat: 6.27,
};

const WAY_AGUA = {
  type: 'way',
  id: 101,
  tags: { natural: 'water', name: 'Laguna' },
  geometry: [
    { lat: 6.2, lon: -75.58 },
    { lat: 6.2, lon: -75.57 },
    { lat: 6.21, lon: -75.57 },
    { lat: 6.21, lon: -75.58 },
    { lat: 6.2, lon: -75.58 },
  ],
};

const WAY_PARQUE = {
  type: 'way',
  id: 202,
  tags: { leisure: 'park', name: 'Parque' },
  geometry: [
    { lat: 6.22, lon: -75.58 },
    { lat: 6.22, lon: -75.57 },
    { lat: 6.23, lon: -75.57 },
    { lat: 6.23, lon: -75.58 },
    { lat: 6.22, lon: -75.58 },
  ],
};

test('caché por (bloque, terreno): acierto, fallo y rechazo de respuesta con error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'overpass-cache-test-'));
  try {
    const cache = crearCacheTerrenos({ dir, log: silencioso });
    assert.equal(claveBloque(BLOQUE_PRUEBA), '-75.62_6.17_-75.53_6.27');

    const query = '[out:json];way(6.17,-75.62,6.27,-75.53);out geom;';
    assert.equal(cache.leer(BLOQUE_PRUEBA, 'agua', query), null);

    const valida = { version: 0.6, elements: [WAY_AGUA] };
    const archivo = cache.guardar(BLOQUE_PRUEBA, 'agua', query, valida);
    assert.match(archivo, /agua__-75\.62_6\.17_-75\.53_6\.27__/);
    assert.deepEqual(cache.leer(BLOQUE_PRUEBA, 'agua', query), valida);

    // Si cambia la consulta o el terreno, no hay colisión
    assert.equal(cache.leer(BLOQUE_PRUEBA, 'parque', query), null);
    assert.equal(cache.leer(BLOQUE_PRUEBA, 'agua', `${query} /* cambio */`), null);

    // Una respuesta con error o mal formada NO se cachea
    assert.throws(
      () =>
        cache.guardar(BLOQUE_PRUEBA, 'bosque', query, {
          elements: [],
          remark: 'runtime error: Query timed out',
        }),
      /No se cachea una respuesta inválida/,
    );
    assert.equal(cache.leer(BLOQUE_PRUEBA, 'bosque', query), null);

    // Si un archivo en disco se corrompe, leer() devuelve null sin romper
    writeFileSync(archivo, '{corrupto', 'utf8');
    assert.equal(cache.leer(BLOQUE_PRUEBA, 'agua', query), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validación de --archivo: rechaza GeoJSON y elementos inválidos, e informa terrenos antes de escribir', async () => {
  assert.match(
    problemaRespuestaOverpass({ type: 'FeatureCollection', features: [] }),
    /GeoJSON/,
  );
  assert.match(problemaRespuestaOverpass({}), /elements/);
  assert.match(
    problemaRespuestaOverpass({ elements: [{ type: 'polygon', id: 1 }] }),
    /tipo inesperado/,
  );
  assert.match(
    problemaRespuestaOverpass({ elements: [{ type: 'way', id: 'abc' }] }),
    /id numérico/,
  );

  const resumen = validarRespuestaOverpass({ elements: [WAY_AGUA, WAY_PARQUE] }, 'prueba.json');
  assert.equal(resumen.elementos, 2);
  assert.deepEqual(resumen.porTipo, { node: 0, way: 2, relation: 0 });

  const ordenEventos = [];
  const logs = [];
  const stats = await cargarArchivos({
    rutas: ['agua-parque.json'],
    leerArchivo: () => JSON.stringify({ elements: [WAY_AGUA, WAY_PARQUE] }),
    log: {
      log(msg) {
        logs.push(msg);
        if (msg.includes('filas válidas por terreno')) ordenEventos.push('imprimio_resumen_previo');
      },
      warn() {},
      error() {},
    },
    escribir: async (filas) => {
      ordenEventos.push(`escribio_${filas.length}`);
    },
  });

  assert.deepEqual(ordenEventos, ['imprimio_resumen_previo', 'escribio_2']);
  assert.deepEqual(stats.validos, { agua: 1, parque: 1 });
  assert.equal(codigoSalida(stats, { log: silencioso }), 0);
});

test('fallo parcial y reanudación: guarda lo que llega, lista faltantes y al reanudar usa caché sin repetir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'overpass-resume-test-'));
  try {
    const cache = crearCacheTerrenos({ dir, log: silencioso });
    const terrenos = ['agua', 'parque'];
    const escritasCorrida1 = [];

    // Corrida 1: agua responde 200, parque falla con 502 en todos los intentos
    let llamadasCorrida1 = 0;
    const cliente1 = crearClienteOverpass({
      endpoints: ['https://a.example/api/interpreter'],
      intentos: 2,
      consultarEstadoAntes: false,
      esperarFn: async () => {},
      log: silencioso,
      fetchFn: async () => {
        llamadasCorrida1 += 1;
        if (llamadasCorrida1 === 1) {
          return new Response(JSON.stringify({ elements: [WAY_AGUA] }), { status: 200 });
        }
        return new Response('at capacity', { status: 502 });
      },
    });

    const stats1 = await cargarBloques({
      bloques: [BLOQUE_PRUEBA],
      terrenos,
      cliente: cliente1,
      cache,
      escribir: async (filas) => escritasCorrida1.push(...filas),
      esperarFn: async () => {},
      pausaMs: 0,
      log: silencioso,
    });

    // Agua se escribió y se cacheó; parque quedó registrado como faltante
    assert.equal(escritasCorrida1.length, 1);
    assert.equal(escritasCorrida1[0].terreno, 'agua');
    assert.equal(stats1.peticiones.red, 1);
    assert.equal(stats1.peticiones.fallidas, 1);
    assert.equal(stats1.faltantes.length, 1);
    assert.equal(stats1.faltantes[0].terreno, 'parque');
    assert.equal(codigoSalida(stats1, { log: silencioso }), 1);

    // Corrida 2 (reanudación): agua sale de caché (0 llamadas HTTP para agua) y solo se pide parque
    let llamadasCorrida2 = 0;
    const escritasCorrida2 = [];
    const cliente2 = crearClienteOverpass({
      endpoints: ['https://a.example/api/interpreter'],
      intentos: 2,
      consultarEstadoAntes: false,
      esperarFn: async () => {},
      log: silencioso,
      fetchFn: async () => {
        llamadasCorrida2 += 1;
        return new Response(JSON.stringify({ elements: [WAY_PARQUE] }), { status: 200 });
      },
    });

    const stats2 = await cargarBloques({
      bloques: [BLOQUE_PRUEBA],
      terrenos,
      cliente: cliente2,
      cache,
      escribir: async (filas) => escritasCorrida2.push(...filas),
      esperarFn: async () => {},
      pausaMs: 0,
      log: silencioso,
    });

    assert.equal(llamadasCorrida2, 1);
    assert.equal(stats2.peticiones.cache, 1);
    assert.equal(stats2.peticiones.red, 1);
    assert.equal(stats2.peticiones.fallidas, 0);
    assert.equal(stats2.faltantes.length, 0);
    assert.equal(escritasCorrida2.length, 2);
    assert.equal(codigoSalida(stats2, { log: silencioso }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('escribirFilas aísla una fila rechazada por Postgres sin abortar las demás', async () => {
  const filas = [
    { osm_tipo: 'way', osm_id: 1, terreno: 'agua', nombre: 'Ok', geom: 'SRID=4326;POLYGON((0 0,0 1,1 1,0 0))', ancho_m: null },
    { osm_tipo: 'way', osm_id: 2, terreno: 'parque', nombre: 'Mala', geom: 'SRID=4326;POLYGON((0 0,0 1,1 1,0 0))', ancho_m: null },
  ];

  const supabaseSimulado = {
    from() {
      return {
        async upsert(grupo) {
          if (grupo.length > 1 || grupo[0].osm_id === 2) {
            return {
              error: {
                code: 'XX000',
                message: 'Geometry could not be converted',
                details: 'way/2 self-intersection',
              },
            };
          }
          return { error: null };
        },
      };
    },
  };

  const stats = crearEstadisticas();
  await escribirFilas(supabaseSimulado, filas, { lote: 200, stats, log: silencioso });

  assert.equal(stats.escritura.ok, 1);
  assert.equal(stats.escritura.fallidas.length, 1);
  assert.equal(stats.escritura.fallidas[0].osm, 'way/2');
  assert.equal(stats.escritura.fallidas[0].codigo, 'XX000');
  assert.match(stats.escritura.fallidas[0].motivo, /XX000/);
  assert.match(stats.escritura.fallidas[0].motivo, /self-intersection/);
});

test('codigoSalida devuelve 1 si no llega ningún elemento', () => {
  const stats = crearEstadisticas();
  assert.equal(codigoSalida(stats, { log: silencioso }), 1);
});

test('resumen separa intentos reales a /api/interpreter de fallos de /api/status incluso cuando la petición falla', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'overpass-resumen-test-'));
  try {
    const cache = crearCacheTerrenos({ dir, log: silencioso });
    const respuestas = [
      // Intento 1 de parque: /api/status 504 -> /api/interpreter 504
      new Response('gateway timeout', { status: 504 }),
      new Response('gateway timeout', { status: 504 }),
      // Intento 2 de parque: /api/status 504 -> /api/interpreter 504
      new Response('gateway timeout', { status: 504 }),
      new Response('gateway timeout', { status: 504 }),
    ];

    const cliente = crearClienteOverpass({
      endpoints: ['https://a.example/api/interpreter'],
      intentos: 2,
      consultarEstadoAntes: true,
      esperarFn: async () => {},
      log: silencioso,
      fetchFn: async () => respuestas.shift(),
    });

    const stats = await cargarBloques({
      bloques: [BLOQUE_PRUEBA],
      solo: 'parque',
      cliente,
      cache,
      escribir: async () => {},
      esperarFn: async () => {},
      pausaMs: 0,
      log: silencioso,
    });

    assert.equal(stats.peticiones.red, 0);
    assert.equal(stats.peticiones.fallidas, 1);
    assert.equal(stats.peticiones.intentosInterpreter, 2);
    assert.equal(stats.peticiones.fallosEstado, 2);

    const lineas = [];
    imprimirResumen(stats, {
      modo: 'overpass',
      log: { log: (m) => lineas.push(m), warn() {}, error() {} },
    });
    const textoResumen = lineas.join('\n');
    assert.match(textoResumen, /intentos \/api\/interpreter 2/);
    assert.match(textoResumen, /fallos \/api\/status 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--solo=terreno y --max-peticiones=N permiten avanzar por tandas sin contar caché contra el tope', async () => {
  assert.deepEqual(resolverTerrenosSolo('parque'), ['parque']);
  assert.deepEqual(resolverTerrenosSolo('parque, bosque, parque'), ['parque', 'bosque']);
  assert.throws(() => resolverTerrenosSolo('oceano'), /--solo inválido/);
  assert.throws(() => resolverTerrenosSolo(''), /--solo necesita/);

  const dir = mkdtempSync(join(tmpdir(), 'overpass-tandas-test-'));
  try {
    const cache = crearCacheTerrenos({ dir, log: silencioso });
    const terrenos = ['agua', 'parque', 'bosque'];

    // Tanda 1: maxPeticiones=1 -> solo pide agua por red y aplaza parque y bosque
    let llamadasTanda1 = 0;
    const cliente1 = crearClienteOverpass({
      endpoints: ['https://a.example/api/interpreter'],
      intentos: 1,
      consultarEstadoAntes: false,
      esperarFn: async () => {},
      log: silencioso,
      fetchFn: async () => {
        llamadasTanda1 += 1;
        return new Response(JSON.stringify({ elements: [WAY_AGUA] }), { status: 200 });
      },
    });

    const stats1 = await cargarBloques({
      bloques: [BLOQUE_PRUEBA],
      terrenos,
      maxPeticiones: 1,
      cliente: cliente1,
      cache,
      escribir: async () => {},
      esperarFn: async () => {},
      pausaMs: 0,
      log: silencioso,
    });

    assert.equal(llamadasTanda1, 1);
    assert.equal(stats1.peticiones.red, 1);
    assert.equal(stats1.peticiones.aplazadas, 2);
    assert.equal(stats1.faltantes.length, 0);
    assert.equal(codigoSalida(stats1, { log: silencioso }), 0);

    // Tanda 2: agua sale de caché (no gasta el tope), maxPeticiones=1 pide parque y aplaza bosque
    let llamadasTanda2 = 0;
    const cliente2 = crearClienteOverpass({
      endpoints: ['https://a.example/api/interpreter'],
      intentos: 1,
      consultarEstadoAntes: false,
      esperarFn: async () => {},
      log: silencioso,
      fetchFn: async () => {
        llamadasTanda2 += 1;
        return new Response(JSON.stringify({ elements: [WAY_PARQUE] }), { status: 200 });
      },
    });

    const stats2 = await cargarBloques({
      bloques: [BLOQUE_PRUEBA],
      terrenos,
      maxPeticiones: 1,
      cliente: cliente2,
      cache,
      escribir: async () => {},
      esperarFn: async () => {},
      pausaMs: 0,
      log: silencioso,
    });

    assert.equal(llamadasTanda2, 1);
    assert.equal(stats2.peticiones.cache, 1);
    assert.equal(stats2.peticiones.red, 1);
    assert.equal(stats2.peticiones.aplazadas, 1);
    assert.equal(stats2.faltantes.length, 0);
    assert.equal(codigoSalida(stats2, { log: silencioso }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
