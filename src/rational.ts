// Exact rational arithmetic over BigInt — the TypeScript counterpart of the
// Ruby Rational values unitsml-ruby's conversion engine computes with.
// Lexical decimals ("273.15", "-0.5", "1e-3") and fractions ("5/9") parse
// exactly; nothing passes through binary floating point.

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("square root of a negative integer");
  if (n < 2n) return n;
  // Integer Newton iteration (Ruby Integer.sqrt): floor(sqrt(n)).
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const FRACTION = /^([+-]?\d+)\/(\d+)$/;

export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(numerator: bigint, denominator: bigint = 1n) {
    if (denominator === 0n) throw new RangeError("divided by 0");
    const sign = denominator < 0n ? -1n : 1n;
    const g = gcd(numerator, denominator) || 1n;
    this.numerator = (sign * numerator) / g;
    this.denominator = (sign * denominator) / g;
  }

  static readonly ZERO = new Rational(0n);
  static readonly ONE = new Rational(1n);

  /** Ruby Rational(x): integers, exact decimal strings and "n/d" fractions. */
  static from(value: Rational | bigint | number | string): Rational {
    if (value instanceof Rational) return value;
    if (typeof value === "bigint") return new Rational(value);
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        // A JS number is a binary double; accept it only via its shortest
        // round-trip decimal spelling, which is what a caller wrote.
        if (!Number.isFinite(value)) throw new RangeError(`not finite: ${value}`);
        return Rational.parse(String(value));
      }
      return new Rational(BigInt(value));
    }
    return Rational.parse(value);
  }

  static parse(text: string): Rational {
    const source = text.trim();
    const fraction = FRACTION.exec(source);
    if (fraction) return new Rational(BigInt(fraction[1]), BigInt(fraction[2]));
    const match = DECIMAL.exec(source);
    if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
      throw new SyntaxError(`invalid value for Rational: ${JSON.stringify(text)}`);
    }
    const [, sign, whole, frac = "", exp = "0"] = match;
    let numerator = BigInt((whole || "0") + frac);
    let denominator = 10n ** BigInt(frac.length);
    const e = BigInt(exp);
    if (e >= 0n) numerator *= 10n ** e;
    else denominator *= 10n ** -e;
    return new Rational(sign === "-" ? -numerator : numerator, denominator);
  }

  add(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  sub(other: Rational): Rational {
    return this.add(other.neg());
  }

  mul(other: Rational): Rational {
    return new Rational(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  div(other: Rational): Rational {
    if (other.numerator === 0n) throw new RangeError("divided by 0");
    return new Rational(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  neg(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  abs(): Rational {
    return this.numerator < 0n ? this.neg() : this;
  }

  inverse(): Rational {
    return Rational.ONE.div(this);
  }

  /** Integer powers only; see powRational for fractional exponents. */
  pow(exponent: number | bigint): Rational {
    const e = BigInt(exponent);
    if (e === 0n) return Rational.ONE;
    const base = e < 0n ? this.inverse() : this;
    const k = e < 0n ? -e : e;
    return new Rational(base.numerator ** k, base.denominator ** k);
  }

  /** Exact square root, or undefined when it is not rational. */
  sqrt(): Rational | undefined {
    if (this.numerator < 0n) return undefined;
    const n = isqrt(this.numerator);
    const d = isqrt(this.denominator);
    return n * n === this.numerator && d * d === this.denominator ? new Rational(n, d) : undefined;
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  isInteger(): boolean {
    return this.denominator === 1n;
  }

  compare(other: Rational): number {
    const lhs = this.numerator * other.denominator;
    const rhs = other.numerator * this.denominator;
    return lhs === rhs ? 0 : lhs < rhs ? -1 : 1;
  }

  equals(other: Rational | bigint | number | string): boolean {
    return this.compare(Rational.from(other)) === 0;
  }

  /** Ruby Rational#to_s: "n/d" ("5/1" for integers). */
  toRubyString(): string {
    return `${this.numerator}/${this.denominator}`;
  }

  /** Ruby Rational#to_i: truncation toward zero. */
  toInteger(): bigint {
    return this.numerator / this.denominator;
  }

  /** "n/d", or "n" for integers. */
  toString(): string {
    return this.isInteger() ? `${this.numerator}` : `${this.numerator}/${this.denominator}`;
  }

  /** The exact decimal spelling ("293.15") when the value terminates in
   * base 10; undefined otherwise (e.g. 1/3). */
  toDecimalString(): string | undefined {
    let d = this.denominator;
    let twos = 0n;
    let fives = 0n;
    while (d % 2n === 0n) { d /= 2n; twos += 1n; }
    while (d % 5n === 0n) { d /= 5n; fives += 1n; }
    if (d !== 1n) return undefined;
    const scale = twos > fives ? twos : fives;
    const scaled = (this.numerator * 10n ** scale) / this.denominator;
    const negative = scaled < 0n;
    const digits = (negative ? -scaled : scaled).toString().padStart(Number(scale) + 1, "0");
    const cut = digits.length - Number(scale);
    const text = scale === 0n ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
    return negative ? `-${text}` : text;
  }

  /** Nearest binary double — for display only, never for further math. */
  toNumber(): number {
    return Number(this.numerator) / Number(this.denominator);
  }
}
