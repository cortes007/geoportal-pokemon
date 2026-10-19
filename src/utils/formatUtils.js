/**
 * formatUtils.js
 * Formateadores puros para UI (antigüedad, distancias, enlaces de navegación).
 */

const UNIDADES = [
  { limite: 60, divisor: 1, singular: 'segundo', plural: 'segundos' },
  { limite: 3600, divisor: 60, singular: 'minuto', plural: 'minutos' },
  { limite: 86400, divisor: 3600, singular: 'hora', plural: 'horas' },
  { limite: 2592000, divisor: 86400, singular: 'día', plural: 'días' },
  { limite: 31536000, divisor: 2592000, singular: 'mes', plural: 'meses' },
  { limite: Infinity, divisor: 31536000, singular: 'año', plural: 'años' },
];

/**
 * Antigüedad legible de un instante ISO (ej. "hace 5 minutos").
 * @param {string|Date} fecha
 * @param {Date} [ahora=new Date()]
 * @returns {string}
 */
export function formatearAntiguedad(fecha, ahora = new Date()) {
  const objetivo = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(objetivo.getTime())) return 'sin fecha';

  const segundos = Math.max(0, Math.floor((ahora.getTime() - objetivo.getTime()) / 1000));
  if (segundos < 5) return 'ahora mismo';

  const unidad = UNIDADES.find((item) => segundos < item.limite);
  if (!unidad) return 'hace mucho';

  const valor = Math.floor(segundos / unidad.divisor);
  if (valor <= 1) return `hace 1 ${unidad.singular}`;
  return `hace ${valor} ${unidad.plural}`;
}

/** Formatea una distancia en metros a texto legible (m / km). */
export function formatearDistancia(metros) {
  if (!Number.isFinite(metros)) return '—';
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(metros < 10000 ? 2 : 1)} km`;
}

/**
 * Enlace universal de navegación "Cómo llegar" (Google Maps).
 * @param {number} latitud
 * @param {number} longitud
 */
export function construirUrlRuta(latitud, longitud) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitud},${longitud}&travelmode=walking`;
}
