export const lerp = (start: number, end: number, progress: number) => {
  return start + (end - start) * progress;
};
