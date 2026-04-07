const FULLSCREEN_BUTTON_ID = "yage-mobile-fullscreen-button";

const isMobileScreen = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarsePointer || window.innerWidth <= 768;
};

const canFullscreen = (): boolean => {
  if (typeof document === "undefined") {
    return false;
  }

  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  return typeof root.requestFullscreen === "function" || typeof root.webkitRequestFullscreen === "function";
};

const isFullscreen = (): boolean => {
  return !!document.fullscreenElement;
};

const requestFullscreen = async (): Promise<void> => {
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  if (typeof root.requestFullscreen === "function") {
    await root.requestFullscreen();
    return;
  }

  if (typeof root.webkitRequestFullscreen === "function") {
    await root.webkitRequestFullscreen();
  }
};

export const ensureMobileFullscreenButton = (): void => {
  if (typeof document === "undefined") {
    return;
  }

  const existing = document.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
  if (!isMobileScreen() || !canFullscreen()) {
    existing?.remove();
    return;
  }

  const updateVisibility = () => {
    const button = document.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
    if (!button) {
      return;
    }
    button.style.display = isFullscreen() ? "none" : "block";
  };

  if (existing) {
    updateVisibility();
    return;
  }

  const button = document.createElement("button");
  button.id = FULLSCREEN_BUTTON_ID;
  button.type = "button";
  button.innerText = "Fullscreen";
  button.setAttribute("aria-label", "Enter fullscreen");
  button.style.position = "fixed";
  button.style.right = "12px";
  button.style.bottom = "12px";
  button.style.zIndex = "10000";
  button.style.padding = "10px 14px";
  button.style.border = "1px solid rgba(255,255,255,0.45)";
  button.style.borderRadius = "999px";
  button.style.background = "rgba(15,20,31,0.88)";
  button.style.color = "white";
  button.style.fontFamily = "YageFont, sans-serif";
  button.style.fontSize = "14px";
  button.style.lineHeight = "1";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 4px 16px rgba(0,0,0,0.35)";
  button.style.touchAction = "manipulation";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await requestFullscreen();
    } catch {
      return;
    }

    updateVisibility();
  });

  document.body.appendChild(button);
  document.addEventListener("fullscreenchange", updateVisibility);
  window.addEventListener("resize", updateVisibility);
  updateVisibility();
};
