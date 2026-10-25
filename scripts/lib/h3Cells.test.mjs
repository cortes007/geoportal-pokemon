import assert from 'node:assert/strict';
import test from 'node:test';
import { getResolution } from 'h3-js';
import {
  BBOX_VALLE_ABURRA,
  bboxAAnillo,
  celdasParaBbox,
  celdaAMetadata,
  celdaAWkt,
  expandirBbox,
  parseBbox,
  tilesParaBbox,
} from './h3Cells.mjs';

test('parseBbox exige oeste,sur,este,norte', () => {
  assert.deepEqual(parseBbox('-75.60,6.19,-75.55,6.25'), [-75.6, 6.19, -75.55, 6.25]);
  assert.throws(() => parseBbox('-75.55,6.19,-75.60,6.25'), /oeste < este/);
  assert.throws(() => parseBbox('-75.60,, -75.55,6.25'), /cuatro valores/);
});

test('bboxAAnillo cierra el anillo', () => {
  const anillo = bboxAAnillo([-75.6, 6.19, -75.55, 6.25]);
  assert.equal(anillo.length, 5);
  assert.deepEqual(anillo[0], anillo[4]);
});

test('celdasParaBbox devuelve celdas de resolución 9 dentro del bbox', () => {
  const bbox = [-75.6, 6.19, -75.55, 6.25];
  const celdas = celdasParaBbox(bbox, 9);

  assert.ok(celdas.length > 0);
  for (const celda of celdas) {
    assert.equal(getResolution(celda), 9);
    const { latitud, longitud } = celdaAMetadata(celda);
    assert.ok(latitud >= bbox[1] && latitud <= bbox[3]);
    assert.ok(longitud >= bbox[0] && longitud <= bbox[2]);
  }
});

test('bbox del Valle de Aburrá produce una malla razonable', () => {
  const celdas = celdasParaBbox(BBOX_VALLE_ABURRA, 9);
  assert.ok(celdas.length > 10_000);
});

test('celdaAWkt produce MULTIPOLYGON cerrado en EPSG:4326', () => {
  const celda = celdasParaBbox([-75.6, 6.19, -75.59, 6.2], 9)[0];
  const wkt = celdaAWkt(celda);

  assert.match(wkt, /^SRID=4326;MULTIPOLYGON\(\(\(/);
  const anillo = wkt.match(/\(\(\((.*)\)\)\)/)?.[1];
  assert.ok(anillo);
  const posiciones = anillo.split(',').map((par) => par.trim());
  assert.equal(posiciones[0], posiciones[posiciones.length - 1]);
});

test('expandirBbox y tilesParaBbox no se solapan', () => {
  const bbox = expandirBbox([-75.6, 6.19, -75.55, 6.25], 0.01);
  const tiles = tilesParaBbox(bbox, 0.02);

  assert.ok(tiles.length > 0);
  for (const tile of tiles) {
    assert.ok(tile.minLon < tile.maxLon);
    assert.ok(tile.minLat < tile.maxLat);
  }
});
