#!/usr/bin/env node
/**
 * scripts/diagnostico-overpass.mjs
 * ---------------------------------------------------------------------------
 * Diagnóstico de los endpoints Overpass configurados. Usa el mismo cliente que
 * cargar-terrenos.mjs (scripts/lib/overpass.mjs), con un solo intento y sin
 * esperar cupo, para ver el estado real de cada servidor.
 *
 * Por endpoint, en secuencia:
 *   1. Resolución DNS del host.
 *   2. GET <base>/api/status (texto crudo e interpretación de cupos).
 *   3. Consulta válida y pequeña (conteo de nodos en ~1 km² de Medellín,
 *      bbox EPSG:4326 sur,oeste,norte,este = 6.2,-75.58,6.21,-75.57).
 * Muestra estado HTTP, tiempo, error.cause y los primeros 200 caracteres.
 *
 * Uso: node scripts/diagnostico-overpass.mjs
 * ---------------------------------------------------------------------------
 */

import { cargarEnv } from './lib/env.mjs';
import {
  USER_AGENT,
  comprobarDns,
  crearClienteOverpass,
  describirError,
  endpointsConfigurados,
  esperar,
  hostsDe,
  origenEndpoints,
  urlEstado,
} from './lib/overpass.mjs';
import { instalarManejadoresGlobales } from './lib/procesoSeguro.mjs';

const PREFIJO = '[diagnostico]';
const CONSULTA_DIAGNOSTICO =
  '[out:json][timeout:25];node(6.2,-75.58,6.21,-75.57);out count;';
const TIMEOUT_CONSULTA_DIAG_MS = 30_000;
const TIMEOUT_ESTADO_DIAG_MS = 5_000;
const PAUSA_ENTRE_ENDPOINTS_MS = 2_000;

function recortar(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').slice(0, 200);
}

async function diagnosticarEndpoint(cliente, endpoint) {
  const host = new URL(endpoint).host;
  console.log(`\n--- ${host} ---`);

  const dns = await comprobarDns(endpoint);
  if (!dns.ok) {
    console.log(`DNS: FALLA (${dns.codigo ?? 's/c'} ${dns.mensaje})`);
    return false;
  }
  console.log(`DNS: ok (${dns.direcciones.join(', ')})`);

  const inicioEstado = Date.now();
  try {
    const estado = await cliente.leerEstado(endpoint);
    console.log(`/api/status: HTTP ${estado.estado} en ${Date.now() - inicioEstado} ms`);
    console.log(`  interpretado: ${JSON.stringify(estado.interpretado)}`);
    console.log(`  texto: ${recortar(estado.texto)}`);
  } catch (error) {
    console.log(`/api/status (${new URL(urlEstado(endpoint)).pathname}): FALLA en ${Date.now() - inicioEstado} ms`);
    console.log(`  ${describirError(error)}`);
  }

  const inicio = Date.now();
  try {
    const resultado = await cliente.pedir(endpoint, CONSULTA_DIAGNOSTICO);
    console.log(`consulta: HTTP ${resultado.estado} en ${Date.now() - inicio} ms`);
    console.log(`  respuesta: ${recortar(resultado.texto)}`);
    return true;
  } catch (error) {
    console.log(`consulta: FALLA en ${Date.now() - inicio} ms`);
    console.log(`  ${describirError(error)}`);
    return false;
  }
}

async function main() {
  instalarManejadoresGlobales(PREFIJO);
  cargarEnv();

  const endpoints = endpointsConfigurados();
  const cliente = crearClienteOverpass({
    endpoints,
    intentos: 1,
    timeoutMs: TIMEOUT_CONSULTA_DIAG_MS,
    timeoutEstadoMs: TIMEOUT_ESTADO_DIAG_MS,
    consultarEstadoAntes: false,
  });

  console.log(`${PREFIJO} User-Agent: ${USER_AGENT}`);
  console.log(`${PREFIJO} endpoints (${origenEndpoints()}): ${hostsDe(endpoints)}`);
  console.log(
    `${PREFIJO} timeouts de diagnóstico: /api/status ${TIMEOUT_ESTADO_DIAG_MS / 1000} s, consulta ${TIMEOUT_CONSULTA_DIAG_MS / 1000} s`,
  );
  console.log(`${PREFIJO} consulta: ${CONSULTA_DIAGNOSTICO}`);

  let correctos = 0;
  for (let i = 0; i < endpoints.length; i += 1) {
    if (i > 0) await esperar(PAUSA_ENTRE_ENDPOINTS_MS);
    if (await diagnosticarEndpoint(cliente, endpoints[i])) correctos += 1;
  }

  console.log(`\n${PREFIJO} endpoints que respondieron la consulta: ${correctos}/${endpoints.length}`);
  if (correctos === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${PREFIJO} ERROR: ${describirError(error)}`);
  process.exitCode = 1;
});
