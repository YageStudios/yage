export class FloatingWindow {
  window: HTMLDivElement;
  dragButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  resizeButton: HTMLButtonElement;

  constructor(private el: HTMLElement, width = 300, height = 300) {
    this.createWindow(width, height);
  }

  createWindow(width: number, height: number) {
    this.window = document.createElement("div");
    this.window.classList.add("floating-this.window");
    this.window.style.position = "fixed";
    this.window.style.top = "0";
    this.window.style.left = "0";
    this.window.style.width = `${width}px`;
    this.window.style.height = `${height}px`;
    this.window.style.zIndex = "100";
    this.window.style.backgroundColor = "beige";
    this.window.style.color = "#black";
    this.window.style.padding = "10px";
    this.window.style.boxSizing = "border-box";
    this.window.style.fontFamily = "monospace";
    this.window.style.fontSize = "16px";

    const windowContainer = document.createElement("div");
    windowContainer.style.position = "absolute";
    windowContainer.style.height = "calc(100% - 20px)";
    windowContainer.style.width = "100%";
    windowContainer.style.top = "20px";
    windowContainer.style.left = "0";
    windowContainer.style.overflow = "auto";
    windowContainer.style.boxSizing = "border-box";
    windowContainer.style.padding = "10px";

    this.dragButton = document.createElement("button");
    this.dragButton.style.position = "absolute";
    this.dragButton.style.top = "0";
    this.dragButton.style.left = "0";
    this.dragButton.style.width = "100%";
    this.dragButton.style.zIndex = "101";
    this.dragButton.style.height = "20px";

    this.closeButton = document.createElement("button");
    this.closeButton.style.position = "absolute";
    this.closeButton.style.top = "0";
    this.closeButton.style.right = "0";
    this.closeButton.style.zIndex = "102";
    this.closeButton.style.height = "20px";
    this.closeButton.style.width = "20px";
    this.closeButton.style.backgroundColor = "red";

    this.resizeButton = document.createElement("button");
    this.resizeButton.style.position = "absolute";
    this.resizeButton.style.bottom = "0";
    this.resizeButton.style.right = "0";
    this.resizeButton.style.zIndex = "102";
    this.resizeButton.style.height = "20px";
    this.resizeButton.style.width = "20px";
    this.resizeButton.style.backgroundColor = "blue";
    this.resizeButton.style.cursor = "nwse-resize";

    if (window.localStorage.getItem("floating-window-size")) {
      const size = JSON.parse(window.localStorage.getItem("floating-window-size") || "");
      this.window.style.width = `${size.width}px`;
      this.window.style.height = `${size.height}px`;
    }

    if (window.localStorage.getItem("floating-window-position")) {
      const position = JSON.parse(window.localStorage.getItem("floating-window-position") || "");
      this.window.style.top = `${Math.max(position.top, 0)}px`;
      this.window.style.left = `${Math.max(position.left, 0)}px`;
    }

    this.window.appendChild(this.dragButton);
    this.window.appendChild(this.closeButton);
    this.window.appendChild(this.resizeButton);

    windowContainer.appendChild(this.el);

    this.window.appendChild(windowContainer);

    document.body.appendChild(this.window);

    this.closeButton.addEventListener("click", () => {
      document.body.removeChild(this.window);
    });

    this.dragButton.addEventListener(
      "mousedown",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = this.window.offsetLeft;
        const startTop = this.window.offsetTop;

        const mouseMove = (e: MouseEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();

          this.window.style.left = `${Math.max(startLeft + e.clientX - startX, 0)}px`;
          this.window.style.top = `${Math.max(startTop + e.clientY - startY, 0)}px`;
          if (e.buttons === 0) {
            mouseUp();
          }
        };

        const mouseUp = () => {
          window.localStorage.setItem(
            "floating-window-position",
            JSON.stringify({
              left: parseInt(this.window.style.left || "0"),
              top: parseInt(this.window.style.top || "0"),
            })
          );
          document.removeEventListener("mousemove", mouseMove, {
            capture: true,
          });
          document.removeEventListener("mouseup", mouseUp, { capture: true });
        };

        document.addEventListener("mousemove", mouseMove, { capture: true });
        document.addEventListener("mouseup", mouseUp);
      },
      { capture: true }
    );

    this.resizeButton.addEventListener("mousedown", (e) => {
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = this.window.offsetWidth;
      const startHeight = this.window.offsetHeight;

      const mouseMove = (e: MouseEvent) => {
        this.window.style.width = `${startWidth + e.clientX - startX}px`;
        this.window.style.height = `${startHeight + e.clientY - startY}px`;
        if (e.buttons === 0) {
          mouseUp();
        }
      };

      const mouseUp = () => {
        window.localStorage.setItem(
          "floating-window-size",
          JSON.stringify({
            width: this.window.offsetWidth,
            height: this.window.offsetHeight,
          })
        );

        document.removeEventListener("mousemove", mouseMove);
        document.removeEventListener("mouseup", mouseUp);
      };

      document.addEventListener("mousemove", mouseMove);
      document.addEventListener("mouseup", mouseUp);
    });
  }

  close() {
    try {
      document.body.removeChild(this.window);
    } finally {
      // nothing
    }
  }
}
