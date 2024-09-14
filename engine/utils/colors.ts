export function hexToRgb(hex: string) {
  if (hex.length === 4) {
    hex = hex.replace(/#([a-f\d])([a-f\d])([a-f\d])/i, (m, r, g, b) => {
      return "#" + r + r + g + g + b + b;
    });
  }
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export function hexToRgbNumber(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? parseInt(result[1] + result[2] + result[3], 16) : 0;
}
