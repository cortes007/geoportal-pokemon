/**
 * constants.js
 * Constantes de dominio (tipos Pokémon, hábitats, capas). Evita "strings mágicos".
 */

/** Identificadores canónicos de tipo de Pokémon (minúsculas, sin acentos). */
export const POKEMON_TIPOS = Object.freeze({
  AGUA: 'agua',
  FUEGO: 'fuego',
  PLANTA: 'planta',
  ELECTRICO: 'electrico',
  NORMAL: 'normal',
  VENENO: 'veneno',
  PSIQUICO: 'psiquico',
  ROCA: 'roca',
  TIERRA: 'tierra',
  VOLADOR: 'volador',
  HIELO: 'hielo',
  DRAGON: 'dragon',
  FANTASMA: 'fantasma',
  LUCHA: 'lucha',
  SINIESTRO: 'siniestro',
  ACERO: 'acero',
  HADA: 'hada',
  BICHO: 'bicho',
});

/** Colores oficiales de la franquicia por tipo. */
export const POKEMON_TIPOS_META = Object.freeze({
  [POKEMON_TIPOS.AGUA]: { id: POKEMON_TIPOS.AGUA, label: 'Agua', color: '#6390F0' },
  [POKEMON_TIPOS.FUEGO]: { id: POKEMON_TIPOS.FUEGO, label: 'Fuego', color: '#EE8130' },
  [POKEMON_TIPOS.PLANTA]: { id: POKEMON_TIPOS.PLANTA, label: 'Planta', color: '#7AC74C' },
  [POKEMON_TIPOS.ELECTRICO]: { id: POKEMON_TIPOS.ELECTRICO, label: 'Eléctrico', color: '#F7D02C' },
  [POKEMON_TIPOS.NORMAL]: { id: POKEMON_TIPOS.NORMAL, label: 'Normal', color: '#A8A77A' },
  [POKEMON_TIPOS.VENENO]: { id: POKEMON_TIPOS.VENENO, label: 'Veneno', color: '#A33EA1' },
  [POKEMON_TIPOS.PSIQUICO]: { id: POKEMON_TIPOS.PSIQUICO, label: 'Psíquico', color: '#F95587' },
  [POKEMON_TIPOS.ROCA]: { id: POKEMON_TIPOS.ROCA, label: 'Roca', color: '#B6A136' },
  [POKEMON_TIPOS.TIERRA]: { id: POKEMON_TIPOS.TIERRA, label: 'Tierra', color: '#E2BF65' },
  [POKEMON_TIPOS.VOLADOR]: { id: POKEMON_TIPOS.VOLADOR, label: 'Volador', color: '#A98FF3' },
  [POKEMON_TIPOS.HIELO]: { id: POKEMON_TIPOS.HIELO, label: 'Hielo', color: '#96D9D6' },
  [POKEMON_TIPOS.DRAGON]: { id: POKEMON_TIPOS.DRAGON, label: 'Dragón', color: '#6F35FC' },
  [POKEMON_TIPOS.FANTASMA]: { id: POKEMON_TIPOS.FANTASMA, label: 'Fantasma', color: '#735797' },
  [POKEMON_TIPOS.LUCHA]: { id: POKEMON_TIPOS.LUCHA, label: 'Lucha', color: '#C22E28' },
  [POKEMON_TIPOS.SINIESTRO]: { id: POKEMON_TIPOS.SINIESTRO, label: 'Siniestro', color: '#705746' },
  [POKEMON_TIPOS.ACERO]: { id: POKEMON_TIPOS.ACERO, label: 'Acero', color: '#B7B7CE' },
  [POKEMON_TIPOS.HADA]: { id: POKEMON_TIPOS.HADA, label: 'Hada', color: '#D685AD' },
  [POKEMON_TIPOS.BICHO]: { id: POKEMON_TIPOS.BICHO, label: 'Bicho', color: '#A6B91A' },
});

export const POKEMON_TIPOS_LISTA = Object.values(POKEMON_TIPOS_META);

/** Tipos de área de hábitat y su color de relleno. */
export const TIPOS_HABITAT = Object.freeze({
  BOSQUE: 'bosque',
  AGUA: 'agua',
  PARQUE: 'parque',
  URBANO: 'urbano',
  COSTERO: 'costero',
});

export const TIPOS_HABITAT_META = Object.freeze({
  [TIPOS_HABITAT.BOSQUE]: { id: TIPOS_HABITAT.BOSQUE, label: 'Bosque', color: '#16a34a' },
  [TIPOS_HABITAT.AGUA]: { id: TIPOS_HABITAT.AGUA, label: 'Cuerpo de agua', color: '#0ea5e9' },
  [TIPOS_HABITAT.PARQUE]: { id: TIPOS_HABITAT.PARQUE, label: 'Parque', color: '#84cc16' },
  [TIPOS_HABITAT.URBANO]: { id: TIPOS_HABITAT.URBANO, label: 'Urbano', color: '#94a3b8' },
  [TIPOS_HABITAT.COSTERO]: { id: TIPOS_HABITAT.COSTERO, label: 'Costero', color: '#06b6d4' },
});

export const TIPOS_HABITAT_LISTA = Object.values(TIPOS_HABITAT_META);

/** Nombres de las capas conmutables del visor. */
export const CAPAS = Object.freeze({
  AVISTAMIENTOS: 'avistamientos',
  NIDOS: 'nidos',
  HABITATS: 'habitats',
  H3: 'h3',
});

export const FILTRO_TODOS = 'todos';

export const AVISTAMIENTOS_TABLE = 'avistamientos';
export const HABITATS_TABLE = 'habitats';
export const RPC_AVISTAMIENTOS_RECIENTES = 'listar_avistamientos_recientes';

/** Resolución H3 por defecto (~celda de 0.1 km² ideal para barrido urbano). */
export const H3_RESOLUCION_POR_DEFECTO = 9;

/** Resuelve metadatos de un tipo de Pokémon con degradación segura. */
export function getPokemonTipoMeta(tipo) {
  return (
    POKEMON_TIPOS_META[tipo] ?? {
      id: tipo ?? 'desconocido',
      label: 'Desconocido',
      color: '#64748b',
    }
  );
}

/** Resuelve metadatos de un tipo de hábitat con degradación segura. */
export function getHabitatTipoMeta(tipo) {
  return (
    TIPOS_HABITAT_META[tipo] ?? {
      id: tipo ?? 'desconocido',
      label: 'Área',
      color: '#64748b',
    }
  );
}
