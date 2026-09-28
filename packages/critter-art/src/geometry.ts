/** Where the face and the worn items sit on a full-size body (viewBox 200, ground at y 182). */
export interface Geometry {
  eyeY: number;
  /** Distance of each eye from the center line. */
  eyeGap: number;
  mouthY: number;
  headTop: number;
  headWidth: number;
  neckY: number;
  neckHalf: number;
  left: number;
  right: number;
}

export const GROUND = 182;
