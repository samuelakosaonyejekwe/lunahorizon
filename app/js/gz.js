// gzip decompression that works everywhere: the browser's built-in DecompressionStream where it exists
// (Chrome 80+, Safari 16.4+, Firefox 113+), else a bundled pure-JS decoder loaded only when needed.
export const hasNativeGzip = typeof DecompressionStream !== 'undefined';

/** Decompress gzip bytes (ArrayBuffer or Uint8Array) to an ArrayBuffer */
export async function gunzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (hasNativeGzip) {
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const { gunzipSync } = await import('../vendor/fflate.js');
  const out = gunzipSync(u8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
