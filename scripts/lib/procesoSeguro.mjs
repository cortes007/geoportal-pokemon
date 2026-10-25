/**
 * scripts/lib/procesoSeguro.mjs
 * ---------------------------------------------------------------------------
 * Manejadores globales para que ningún script termine en silencio.
 * Imprimen el motivo de: promesas rechazadas sin manejar, excepciones no
 * capturadas, Ctrl+C (SIGINT) y el código de salida final.
 * ---------------------------------------------------------------------------
 */

let instalados = false;

/** @param {string} prefijo Ej. '[terrenos]'. */
export function instalarManejadoresGlobales(prefijo) {
  if (instalados) return;
  instalados = true;

  process.on('unhandledRejection', (motivo) => {
    console.error(`${prefijo} promesa rechazada sin manejar:`, motivo);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error(`${prefijo} excepción no capturada:`, error);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.error(`${prefijo} interrumpido por el usuario (Ctrl+C).`);
    process.exit(130);
  });

  process.on('exit', (codigo) => {
    const texto = codigo === 0 ? 'correcto' : 'con error';
    console.error(`${prefijo} proceso terminado (${texto}), código de salida ${codigo}.`);
  });
}
