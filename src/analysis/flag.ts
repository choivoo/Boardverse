/** Build-time switch: `VITE_ENGINE=0 npm run build` ships NO Stockfish files and hides engine analysis (e.g. until the GPL question is settled). */
export const ENGINE_ENABLED = import.meta.env.VITE_ENGINE !== '0';
