interface SpringProps {
  stiffness: number;
  damping: number;
  mass: number;
}

export function springLerp(t: number, start: number, end: number, { stiffness, damping, mass }: SpringProps): number {
  const angularFrequency = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));

  if (dampingRatio < 1) {
    // Underdamped
    const dampedFreq = angularFrequency * Math.sqrt(1 - dampingRatio * dampingRatio);
    const A = end - start;
    const decay = Math.exp(-dampingRatio * angularFrequency * t);
    const oscillation =
      A *
      decay *
      (Math.cos(dampedFreq * t) + ((dampingRatio * angularFrequency) / dampedFreq) * Math.sin(dampedFreq * t));
    return end - oscillation;
  } else if (dampingRatio === 1) {
    // Critically damped
    const A = end - start;
    const decay = Math.exp(-angularFrequency * t);
    return end - A * decay * (1 + angularFrequency * t);
  } else {
    // Overdamped
    const sqrtTerm = Math.sqrt(dampingRatio * dampingRatio - 1);
    const A = end - start;
    const decay = Math.exp(-dampingRatio * angularFrequency * t);
    const alpha = -angularFrequency * (dampingRatio - sqrtTerm);
    const beta = -angularFrequency * (dampingRatio + sqrtTerm);
    return (
      end -
      A *
        decay *
        (((alpha + dampingRatio * angularFrequency) / (alpha - beta)) * Math.exp(alpha * t) -
          ((beta + dampingRatio * angularFrequency) / (alpha - beta)) * Math.exp(beta * t))
    );
  }
}

export function springLerpVec2(
  t: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  springProps: SpringProps
): { x: number; y: number } {
  return {
    x: springLerp(t, start.x, end.x, springProps),
    y: springLerp(t, start.y, end.y, springProps),
  };
}
