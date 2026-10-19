import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import { getHabitatTipoMeta, getPokemonTipoMeta } from '../config/constants';

/**
 * mapStyles.js
 * Fábrica pura de estilos de OpenLayers con caché (el style function se ejecuta
 * en cada frame de render).
 */

const styleCache = new Map();

/** Estilo de marcador de avistamiento: círculo; nido = estrella más grande. */
export function createAvistamientoStyle(feature) {
  const tipo = feature.get('pokemon_type');
  const esNido = Boolean(feature.get('es_nido'));
  const selected = Boolean(feature.get('selected'));
  const cacheKey = `avistamiento|${tipo}|${esNido}|${selected}`;

  if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);

  const color = getPokemonTipoMeta(tipo).color;

  const shape = esNido
    ? new RegularShape({
        points: 5,
        radius: selected ? 14 : 11,
        radius2: selected ? 6 : 5,
        angle: 0,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: selected ? '#0f172a' : '#ffffff', width: selected ? 3 : 2 }),
      })
    : new CircleStyle({
        radius: selected ? 11 : 7,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: selected ? '#0f172a' : '#ffffff', width: selected ? 3 : 2 }),
      });

  const style = new Style({ image: shape, zIndex: selected ? 20 : esNido ? 10 : 5 });
  styleCache.set(cacheKey, style);
  return style;
}

/** Estilo de polígono de hábitat según tipo de área. */
export function createHabitatStyle(feature) {
  const tipo = feature.get('tipo_area');
  const cacheKey = `habitat|${tipo}`;

  if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);

  const color = getHabitatTipoMeta(tipo).color;

  const style = new Style({
    fill: new Fill({ color: `${color}33` }), // ~20% alfa
    stroke: new Stroke({ color, width: 2, lineDash: [6, 4] }),
    text: new Text({
      text: feature.get('nombre') ?? '',
      font: '500 11px ui-sans-serif, system-ui',
      fill: new Fill({ color: '#334155' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
    }),
  });
  styleCache.set(cacheKey, style);
  return style;
}

/** Estilo choropleth de celda H3 según la densidad (count). */
export function createH3Style(feature) {
  const count = Number(feature.get('count') ?? 0);
  const bucket = Math.min(5, Math.max(1, count)); // 1..5+
  const cacheKey = `h3|${bucket}`;

  if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);

  const escala = ['#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7', '#075985'];
  const style = new Style({
    fill: new Fill({ color: `${escala[bucket - 1]}55` }),
    stroke: new Stroke({ color: '#0c4a6e', width: 1 }),
  });
  styleCache.set(cacheKey, style);
  return style;
}
