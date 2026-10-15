// Cache-busting for data files (room.glb, textures, json): GitHub Pages lets browsers keep them for 10 min, so after a
// publish visitors could still see the old room. Every build gets its own ?v=, dev has none.
declare const __BUILD__: string;
export const V = import.meta.env.DEV ? "" : "?v=" + __BUILD__;
