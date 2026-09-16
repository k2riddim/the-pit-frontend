// The source PNG is preserved. This renderer-side matte is restricted to the
// generated prop atlas: never run it on canonical avatars or arbitrary uploads.
export const PROP_WINDOWS = [
  [40, 7, 326, 355, []], [408, 79, 335, 251, []], [803, 54, 315, 297, []],
  [1214, 15, 289, 354, [[120, 125], [125, 267], [185, 231]]],
  [56, 372, 270, 310, [[67, 93], [95, 97], [120, 100], [148, 94]]],
  [386, 386, 366, 268, [[129, 156], [184, 163], [241, 177]]],
  [769, 367, 387, 300, [[229, 225]]], [1218, 363, 273, 313, []],
  [67, 683, 269, 304, []], [393, 678, 355, 304, []],
  [777, 700, 345, 243, [[177, 43]]], [1182, 683, 324, 294, []],
];

// A connected neutral matte removes exterior checker pixels without keying out
// enclosed white object paint. Reviewed hole seeds cover enclosed chair openings.
export function mattePropPixels(data, width, height, holes = []) {
  if (data.length !== width * height * 4) throw new RangeError('RGBA dimensions do not match');
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x; if (seen[p]) return; seen[p] = 1;
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] === 0 || (Math.min(r, g, b) >= 165 && Math.max(r, g, b) - Math.min(r, g, b) <= 19)) queue[tail++] = p;
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (const [x, y] of holes) visit(x, y);
  while (head < tail) { const p = queue[head++], x = p % width, y = Math.floor(p / width); data[p * 4 + 3] = 0; visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1); }
  return data;
}

export function preparePropSprites(atlas, windows = PROP_WINDOWS) {
  if (atlas.naturalWidth !== 1536 || atlas.naturalHeight !== 1024) throw new Error('Unexpected prop atlas version');
  return windows.map(([x, y, width, height, holes, exclusions = []]) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d', { willReadFrequently: true }); g.drawImage(atlas, x, y, width, height, 0, 0, width, height);
    const frame = g.getImageData(0, 0, width, height); mattePropPixels(frame.data, width, height, holes); g.putImageData(frame, 0, 0);
    for (const [rx, ry, rw, rh] of exclusions) g.clearRect(rx, ry, rw, rh);
    return canvas;
  });
}
