/**
 * habitatsDemo.js
 * GeoJSON de respaldo (EPSG:4326) para que la capa de Hábitats tenga contenido
 * aunque Supabase no esté configurado o la tabla `habitats` esté vacía.
 */
export const HABITATS_DEMO = Object.freeze({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { nombre: 'Humedal La Conejera', tipo_area: 'agua' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74.1046, 4.7573],
            [-74.0936, 4.7562],
            [-74.0898, 4.7481],
            [-74.1002, 4.7449],
            [-74.1071, 4.7505],
            [-74.1046, 4.7573],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { nombre: 'Parque Simón Bolívar', tipo_area: 'parque' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74.1021, 4.6651],
            [-74.0839, 4.6642],
            [-74.0827, 4.6521],
            [-74.1003, 4.65],
            [-74.1021, 4.6651],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { nombre: 'Cerros Orientales', tipo_area: 'bosque' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74.0551, 4.6702],
            [-74.0387, 4.6682],
            [-74.0342, 4.6401],
            [-74.0512, 4.6385],
            [-74.0551, 4.6702],
          ],
        ],
      },
    },
  ],
});
