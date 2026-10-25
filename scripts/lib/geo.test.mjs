import assert from 'node:assert/strict';
import test from 'node:test';
import { geojsonToEwkt } from './geo.mjs';

test('Polygon -> EWKT cierra el anillo', () => {
  const ewkt = geojsonToEwkt({
    type: 'Polygon',
    coordinates: [
      [
        [-75.6, 6.2],
        [-75.59, 6.2],
        [-75.59, 6.21],
        [-75.6, 6.21],
      ],
    ],
  });

  assert.equal(
    ewkt,
    'SRID=4326;POLYGON((-75.6 6.2,-75.59 6.2,-75.59 6.21,-75.6 6.21,-75.6 6.2))',
  );
});

test('MultiPolygon con hueco -> EWKT', () => {
  const ewkt = geojsonToEwkt({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
        [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.75, 0.75],
          [0.25, 0.75],
          [0.25, 0.25],
        ],
      ],
    ],
  });

  assert.match(ewkt, /^SRID=4326;MULTIPOLYGON\(\(\(0 0,1 0,1 1,0 1,0 0\),\(0\.25 0\.25,/);
});

test('LineString -> EWKT', () => {
  const ewkt = geojsonToEwkt({
    type: 'LineString',
    coordinates: [
      [-75.6, 6.2],
      [-75.59, 6.2],
    ],
  });

  assert.equal(ewkt, 'SRID=4326;LINESTRING(-75.6 6.2,-75.59 6.2)');
});

test('rechaza coordenadas fuera de rango', () => {
  assert.throws(
    () =>
      geojsonToEwkt({
        type: 'Point',
        coordinates: [200, 6.2],
      }),
    /longitud fuera de rango/,
  );
});

test('rechaza tipos no soportados', () => {
  assert.throws(
    () =>
      geojsonToEwkt({
        type: 'GeometryCollection',
        geometries: [],
      }),
    /tipo no soportado/,
  );
});
