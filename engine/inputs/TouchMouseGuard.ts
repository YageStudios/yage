const SYNTHETIC_MOUSE_SUPPRESSION_MS = 800;

let lastTouchInteractionAt = 0;

export const markTouchInteraction = (timestamp: number = Date.now()): void => {
  lastTouchInteractionAt = timestamp;
};

export const isSyntheticMouseEvent = (timestamp: number = Date.now()): boolean => {
  return timestamp - lastTouchInteractionAt >= 0 && timestamp - lastTouchInteractionAt < SYNTHETIC_MOUSE_SUPPRESSION_MS;
};
