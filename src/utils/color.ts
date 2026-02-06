/**
 * Color utilities for visualization and fitness mapping.
 * @module utils/color
 */

/**
 * RGB color representation
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * HSL color representation
 */
export interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

/**
 * Maps fitness value to RGB color
 * Lower fitness = red, higher fitness = green
 * @param fitness Current fitness value
 * @param maxFitness Maximum fitness value (for normalization)
 * @returns RGB color string (e.g., "rgb(255, 0, 0)")
 */
export function fitnessToColor(fitness: number, maxFitness: number): string {
  if (maxFitness === 0) {
    return 'rgb(128, 128, 128)'; // Gray for zero fitness
  }
  
  // Normalize fitness to 0..1
  const ratio = Math.max(0, Math.min(1, fitness / maxFitness));
  
  // Red (low fitness) to Green (high fitness)
  const r = Math.floor(255 * (1 - ratio));
  const g = Math.floor(255 * ratio);
  const b = 0;
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Converts HSL color to RGB
 * @param h Hue (0..360)
 * @param s Saturation (0..1)
 * @param l Lightness (0..1)
 * @returns RGB color object
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  h = h % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }
  
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Converts RGB color to HSL
 * @param r Red component (0..255)
 * @param g Green component (0..255)
 * @param b Blue component (0..255)
 * @returns HSL color object
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  r = Math.max(0, Math.min(255, r)) / 255;
  g = Math.max(0, Math.min(255, g)) / 255;
  b = Math.max(0, Math.min(255, b)) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  
  if (h < 0) h += 360;
  
  return {
    h,
    s,
    l,
  };
}

/**
 * Interpolates between two RGB colors
 * @param color1 First color
 * @param color2 Second color
 * @param t Interpolation factor (0..1, where 0 = color1, 1 = color2)
 * @returns RGB color string
 */
export function interpolateColor(
  color1: RGB | string,
  color2: RGB | string,
  t: number
): string {
  const clampedT = Math.max(0, Math.min(1, t));
  
  // Parse string colors if needed
  let rgb1: RGB, rgb2: RGB;
  
  if (typeof color1 === 'string') {
    rgb1 = parseRgbString(color1);
  } else {
    rgb1 = color1;
  }
  
  if (typeof color2 === 'string') {
    rgb2 = parseRgbString(color2);
  } else {
    rgb2 = color2;
  }
  
  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * clampedT);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * clampedT);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * clampedT);
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Parses an RGB string to RGB object
 * @param rgbString RGB string (e.g., "rgb(255, 0, 0)")
 * @returns RGB color object
 */
function parseRgbString(rgbString: string): RGB {
  const match = rgbString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) {
    throw new Error(`Invalid RGB string: ${rgbString}`);
  }
  
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
  };
}
