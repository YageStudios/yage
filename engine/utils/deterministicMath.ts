/**
 * Deterministic replacements for the transcendental Math.* functions.
 *
 * JS engines are allowed to differ in the last bits of Math.sin/cos/tan/atan2/
 * exp/log/pow, which silently desyncs a lockstep simulation across browsers.
 * These implementations use only +, -, *, / and Math.sqrt - basic IEEE 754
 * arithmetic that every engine must round identically - so identical inputs
 * produce bit-identical outputs everywhere. Accuracy is within ~1e-9 of the
 * native functions, far below anything perceptible in gameplay.
 *
 * Sim systems must import from here instead of using Math.*; the ESLint
 * no-restricted-properties rules in .eslintrc.json enforce it.
 */

const PI = 3.141592653589793;
// Two-part constants (Cody-Waite splitting): the high part has enough trailing
// zero bits that k * HIGH is exact for moderate k, and the low part mops up
// most of the remaining representation error.
const PIO2_HI = 1.5707963267948966;
const PIO2_LO = 6.123233995736766e-17;
const LN2_HI = 0.6931471805599453;
const LN2_LO = 2.3190468138462996e-17;

// sin(r) on |r| <= pi/4, Taylor through r^13 (remainder < 1e-14).
const sinPoly = (r: number): number => {
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800)))))))
  );
};

// cos(r) on |r| <= pi/4, Taylor through r^14 (remainder < 1e-15).
const cosPoly = (r: number): number => {
  const r2 = r * r;
  return (
    1 +
    r2 *
      (-1 / 2 +
        r2 *
          (1 / 24 +
            r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200)))))))
  );
};

/** Reduce x to r in [-pi/4, pi/4] plus the quadrant index k (x = k*pi/2 + r). */
const reduceTrig = (x: number): [number, number] => {
  const k = Math.round(x * (2 / PI));
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  return [r, k];
};

export const sin = (x: number): number => {
  const [r, k] = reduceTrig(x);
  switch (((k % 4) + 4) % 4) {
    case 0:
      return sinPoly(r);
    case 1:
      return cosPoly(r);
    case 2:
      return -sinPoly(r);
    default:
      return -cosPoly(r);
  }
};

export const cos = (x: number): number => {
  const [r, k] = reduceTrig(x);
  switch (((k % 4) + 4) % 4) {
    case 0:
      return cosPoly(r);
    case 1:
      return -sinPoly(r);
    case 2:
      return -cosPoly(r);
    default:
      return sinPoly(r);
  }
};

export const tan = (x: number): number => sin(x) / cos(x);

/** atan(t) for t in [0, 1] via a triple half-angle reduction then Taylor. */
const atanCore = (t: number): number => {
  // atan(t) = 2 * atan(t / (1 + sqrt(1 + t^2))). Three rounds shrink the
  // argument below ~0.2 where the Taylor series converges quickly.
  let u = t;
  for (let i = 0; i < 3; i++) {
    u = u / (1 + Math.sqrt(1 + u * u));
  }
  const u2 = u * u;
  const series =
    u *
    (1 +
      u2 *
        (-1 / 3 +
          u2 *
            (1 / 5 +
              u2 * (-1 / 7 + u2 * (1 / 9 + u2 * (-1 / 11 + u2 * (1 / 13 + u2 * (-1 / 15))))))));
  return 8 * series;
};

export const atan = (t: number): number => {
  if (t !== t) {
    return NaN;
  }
  if (t < 0) {
    return -atan(-t);
  }
  if (t > 1) {
    return PI / 2 - atanCore(1 / t);
  }
  return atanCore(t);
};

export const atan2 = (y: number, x: number): number => {
  if (x > 0) {
    return atan(y / x);
  }
  if (x < 0) {
    return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  }
  // x is 0 or -0
  if (y > 0) {
    return PI / 2;
  }
  if (y < 0) {
    return -PI / 2;
  }
  return y === 0 ? (Object.is(y, -0) && Object.is(x, -0) ? -PI : 0) : NaN;
};

const scaleByPow2 = (value: number, k: number): number => {
  let result = value;
  if (k > 0) {
    for (let i = 0; i < k; i++) {
      result *= 2;
    }
  } else {
    for (let i = 0; i > k; i--) {
      result /= 2;
    }
  }
  return result;
};

export const exp = (x: number): number => {
  if (x !== x) {
    return NaN;
  }
  if (x < -745) {
    return 0;
  }
  if (x > 709) {
    return Infinity;
  }
  const k = Math.round(x / LN2_HI);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  // Taylor through r^12: the dropped r^13/13! term is below 1e-16 for |r| <= ln2/2.
  const series =
    1 +
    r *
      (1 +
        r *
          (1 / 2 +
            r *
              (1 / 6 +
                r *
                  (1 / 24 +
                    r *
                      (1 / 120 +
                        r *
                          (1 / 720 +
                            r *
                              (1 / 5040 +
                                r * (1 / 40320 + r * (1 / 362880 + r * (1 / 3628800 + r * (1 / 39916800 + r / 479001600)))))))))));
  return scaleByPow2(series, k);
};

export const log = (x: number): number => {
  if (x !== x || x < 0) {
    return NaN;
  }
  if (x === 0) {
    return -Infinity;
  }
  if (x === Infinity) {
    return Infinity;
  }
  // Normalize x = m * 2^n with m in [1, 2), then log(m) via the atanh series
  // with s = (m - 1) / (m + 1): log(m) = 2 * (s + s^3/3 + s^5/5 + ...).
  let m = x;
  let n = 0;
  while (m >= 2) {
    m /= 2;
    n++;
  }
  while (m < 1) {
    m *= 2;
    n--;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  const series =
    s *
    (1 +
      s2 *
        (1 / 3 +
          s2 *
            (1 / 5 +
              s2 *
                (1 / 7 +
                  s2 * (1 / 9 + s2 * (1 / 11 + s2 * (1 / 13 + s2 * (1 / 15 + s2 * (1 / 17 + s2 / 19)))))))));
  return n * LN2_HI + (n * LN2_LO + 2 * series);
};

export const pow = (x: number, y: number): number => {
  if (y === 0) {
    return 1;
  }
  if (x === 1) {
    return 1;
  }
  if (Number.isInteger(y) && Math.abs(y) <= 1024) {
    // Exponentiation by squaring: exact for integer powers of two and
    // deterministic everywhere.
    let base = x;
    let exponent = y;
    let result = 1;
    if (exponent < 0) {
      base = 1 / base;
      exponent = -exponent;
    }
    while (exponent > 0) {
      if (exponent & 1) {
        result *= base;
      }
      base *= base;
      exponent = Math.floor(exponent / 2);
    }
    return result;
  }
  if (x > 0) {
    return exp(y * log(x));
  }
  if (x === 0) {
    return y > 0 ? 0 : Infinity;
  }
  return NaN;
};

/**
 * hypot via sqrt: Math.sqrt is required by IEEE 754 and the JS spec to be
 * correctly rounded, so it is deterministic across engines (unlike the
 * transcendental functions). Overflow for astronomically large inputs is not
 * a game-scale concern.
 */
export const hypot = (a: number, b: number): number => Math.sqrt(a * a + b * b);
