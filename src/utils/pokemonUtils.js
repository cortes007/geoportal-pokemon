import { FILTRO_TODOS } from '../config/constants';
import { isValidCoordinate } from './spatialUtils';

/**
 * pokemonUtils.js
 * Lógica pura de filtrado/validación de avistamientos. Sin React ni Supabase.
 */

/** Indica si un avistamiento tiene coordenadas geográficas utilizables. */
export function hasValidCoordinates(avistamiento) {
  if (!avistamiento) return false;
  return isValidCoordinate([avistamiento.longitud, avistamiento.latitud]);
}

/**
 * Normaliza la búsqueda: acepta nombre o ID de Pokémon.
 * @returns {boolean} true si el avistamiento coincide con el término.
 */
function coincideBusqueda(avistamiento, termino) {
  if (!termino) return true;

  const idNumerico = Number.parseInt(termino, 10);
  if (Number.isInteger(idNumerico) && `${avistamiento.pokemon_id}` === `${idNumerico}`) {
    return true;
  }

  const texto = [avistamiento.pokemon_name, avistamiento.descripcion, avistamiento.reportado_por]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return texto.includes(termino);
}

/**
 * Filtra avistamientos por búsqueda, tipo y visibilidad de capas.
 *
 * @param {Array<object>} avistamientos
 * @param {{ query?: string, tipo?: string }} filters
 * @param {Record<string, boolean>} capas Visibilidad: { avistamientos, nidos }.
 * @returns {Array<object>} Nueva colección filtrada (inmutable).
 */
export function filterAvistamientos(avistamientos, filters = {}, capas = {}) {
  if (!Array.isArray(avistamientos)) return [];

  const termino = (filters.query ?? '').trim().toLowerCase();
  const tipo = filters.tipo ?? FILTRO_TODOS;

  return avistamientos.filter((avistamiento) => {
    const esNido = Boolean(avistamiento.es_nido);

    if (esNido && capas.nidos === false) return false;
    if (!esNido && capas.avistamientos === false) return false;
    if (tipo !== FILTRO_TODOS && avistamiento.pokemon_type !== tipo) return false;

    return coincideBusqueda(avistamiento, termino);
  });
}

/** Inserta o actualiza un registro por id, preservando la inmutabilidad. */
export function upsertById(coleccion, registro) {
  if (!registro?.id) return coleccion;

  const indice = coleccion.findIndex((item) => item.id === registro.id);
  if (indice === -1) return [registro, ...coleccion];

  const copia = [...coleccion];
  copia[indice] = { ...copia[indice], ...registro };
  return copia;
}

/** Cuenta avistamientos y nidos por separado (KPIs para la UI). */
export function contarPorTipo(avistamientos) {
  return (avistamientos ?? []).reduce(
    (acumulado, item) => {
      if (item.es_nido) acumulado.nidos += 1;
      else acumulado.avistamientos += 1;
      return acumulado;
    },
    { avistamientos: 0, nidos: 0 },
  );
}
