import assert from 'node:assert/strict';
import test from 'node:test';
import osmtogeojson from 'osmtogeojson';
import {
  PRIORIDAD_TERRENOS,
  TERRENOS_CONSULTABLES,
  anchoWaterway,
  bboxOverpass,
  clasificarTerreno,
  consultaOverpassTerreno,
  filaDesdeFeature,
} from './terrenos.mjs';

test('prioridad de terrenos aprobada', () => {
  assert.deepEqual(PRIORIDAD_TERRENOS, [
    'agua',
    'cementerio',
    'industrial',
    'parque',
    'bosque',
    'cerro',
  ]);
  assert.deepEqual(TERRENOS_CONSULTABLES, [
    'agua',
    'cementerio',
    'industrial',
    'parque',
    'bosque',
  ]);
});

test('un elemento con varias etiquetas usa la prioridad', () => {
  assert.equal(clasificarTerreno({ natural: 'water', leisure: 'park' }), 'agua');
  assert.equal(clasificarTerreno({ landuse: 'cemetery', leisure: 'park' }), 'cementerio');
  assert.equal(clasificarTerreno({ landuse: 'industrial', leisure: 'park' }), 'industrial');
  assert.equal(clasificarTerreno({ leisure: 'park', landuse: 'forest' }), 'parque');
  assert.equal(clasificarTerreno({ landuse: 'forest' }), 'bosque');
  assert.equal(clasificarTerreno({ landuse: 'residential' }), null);
});

test('ancho de líneas de agua', () => {
  assert.equal(anchoWaterway({ waterway: 'river' }), 40);
  assert.equal(anchoWaterway({ waterway: 'stream' }), 8);
  assert.equal(anchoWaterway({ waterway: 'canal' }), 12);
  assert.equal(anchoWaterway({ waterway: 'ditch' }), 4);
  assert.equal(anchoWaterway({ waterway: 'stream', width: '15' }), 15);
  assert.equal(anchoWaterway({ waterway: 'stream', width: '500' }), 8);
});

test('consultaOverpassTerreno genera consultas separadas por terreno con bbox redondeado', () => {
  const bloque = {
    minLon: -75.61999999999999,
    minLat: 6.170000000000001,
    maxLon: -75.53,
    maxLat: 6.27,
  };
  assert.equal(bboxOverpass(bloque), '6.17,-75.62,6.27,-75.53');

  const qAgua = consultaOverpassTerreno('agua', bloque, { timeoutS: 120 });
  assert.match(qAgua, /\[out:json\]\[timeout:120\];/);
  assert.match(qAgua, /natural/);
  assert.match(qAgua, /waterway/);
  assert.match(qAgua, /\(6\.17,-75\.62,6\.27,-75\.53\)/);
  assert.match(qAgua, /out geom;/);
  assert.doesNotMatch(qAgua, /cemetery/);

  const qCem = consultaOverpassTerreno('cementerio', bloque);
  assert.match(qCem, /cemetery/);
  assert.match(qCem, /grave_yard/);

  const qInd = consultaOverpassTerreno('industrial', bloque);
  assert.match(qInd, /industrial|quarry/);
  assert.match(qInd, /railway/);

  const qPar = consultaOverpassTerreno('parque', bloque);
  assert.match(qPar, /leisure/);
  assert.match(qPar, /recreation_ground/);

  const qBos = consultaOverpassTerreno('bosque', bloque);
  assert.match(qBos, /nature_reserve/);
  assert.match(qBos, /forest/);
  assert.match(qBos, /wood|scrub/);

  assert.throws(() => consultaOverpassTerreno('cerro', bloque), /no consultable/);
});

test('filaDesdeFeature construye fila válida o devuelve motivo de descarte', () => {
  const ok = filaDesdeFeature({
    id: 'way/123',
    properties: { leisure: 'park', name: 'Parque Lleras' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-75.57, 6.21],
          [-75.56, 6.21],
          [-75.56, 6.22],
          [-75.57, 6.22],
          [-75.57, 6.21],
        ],
      ],
    },
  });
  assert.equal(ok.fila.osm_tipo, 'way');
  assert.equal(ok.fila.osm_id, 123);
  assert.equal(ok.fila.terreno, 'parque');
  assert.equal(ok.fila.nombre, 'Parque Lleras');
  assert.equal(ok.fila.ancho_m, null);
  assert.match(ok.fila.geom, /^SRID=4326;POLYGON/);

  const sinTerreno = filaDesdeFeature({
    id: 'way/124',
    properties: { highway: 'residential' },
    geometry: { type: 'LineString', coordinates: [[-75.57, 6.21], [-75.56, 6.21]] },
  });
  assert.equal(sinTerreno.motivo, 'etiquetas sin terreno');

  const lineaNoAgua = filaDesdeFeature({
    id: 'way/125',
    properties: { leisure: 'park' },
    geometry: { type: 'LineString', coordinates: [[-75.57, 6.21], [-75.56, 6.21]] },
  });
  assert.equal(lineaNoAgua.motivo, 'línea que no es agua');
});

test('osmtogeojson ensambla una relación con geometría de miembros', () => {
  const osm = {
    elements: [
      {
        type: 'relation',
        id: 2,
        tags: { type: 'multipolygon', natural: 'water' },
        members: [
          {
            type: 'way',
            ref: 1,
            role: 'outer',
            geometry: [
              { lat: 0, lon: 0 },
              { lat: 0, lon: 1 },
              { lat: 1, lon: 1 },
              { lat: 1, lon: 0 },
              { lat: 0, lon: 0 },
            ],
          },
        ],
      },
    ],
  };

  const geojson = osmtogeojson(osm);
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].geometry.type, 'Polygon');
});
