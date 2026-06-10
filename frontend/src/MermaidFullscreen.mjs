import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  fitMermaidTransform,
  zoomMermaidTransform
} from "./mermaidViewport.mjs";

const INITIAL_TRANSFORM = { scale: 1, x: 0, y: 0 };
const INITIAL_SIZE = { width: 1, height: 1 };

export function canShowMermaidFullscreen(status, showSource) {
  return status === "ready" && !showSource;
}

function namespaceMermaidSvg(svg, suffix) {
  const rootId = String(svg || "").match(/<svg\b[^>]*\bid="([^"]+)"/i)?.[1];
  return rootId ? svg.replaceAll(rootId, `${rootId}-${suffix}`) : svg;
}

function readSvgSize(container) {
  const svg = container?.querySelector("svg");
  if (!svg) return INITIAL_SIZE;

  const viewBox = svg.viewBox?.baseVal;
  if (viewBox?.width > 0 && viewBox?.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const rect = svg.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

export function MermaidFullscreen({ svg }) {
  const suffix = useId().replace(/[^A-Za-z0-9_-]/g, "") || "fullscreen";
  const fullscreenSvg = useMemo(
    () => namespaceMermaidSvg(String(svg || ""), suffix),
    [suffix, svg]
  );
  const triggerRef = useRef(null);
  const viewerRef = useRef(null);
  const viewportRef = useRef(null);
  const diagramRef = useRef(null);
  const closeButtonRef = useRef(null);
  const dragRef = useRef(null);
  const nativeFullscreenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fitted, setFitted] = useState(false);
  const [diagramSize, setDiagramSize] = useState(INITIAL_SIZE);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);

  const restoreTriggerFocus = useCallback(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const finishClose = useCallback(() => {
    nativeFullscreenRef.current = false;
    dragRef.current = null;
    setDragging(false);
    setOpen(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const closeViewer = useCallback(async () => {
    if (
      typeof document !== "undefined" &&
      document.fullscreenElement === viewerRef.current &&
      typeof document.exitFullscreen === "function"
    ) {
      try {
        await document.exitFullscreen();
      } catch {
        // The overlay still closes if the browser rejects exitFullscreen.
      }
    }
    finishClose();
  }, [finishClose]);

  const fitViewer = useCallback(() => {
    const viewport = viewportRef.current;
    const diagram = diagramRef.current;
    if (!viewport || !diagram) return;

    const viewportRect = viewport.getBoundingClientRect();
    const nextDiagramSize = readSvgSize(diagram);
    setDiagramSize(nextDiagramSize);
    setTransform(
      fitMermaidTransform(
        { width: viewportRect.width, height: viewportRect.height },
        nextDiagramSize
      )
    );
    setFitted(true);
  }, []);

  const openViewer = useCallback(async () => {
    flushSync(() => {
      setFitted(false);
      setTransform(INITIAL_TRANSFORM);
      setOpen(true);
    });

    const viewer = viewerRef.current;
    if (viewer && typeof viewer.requestFullscreen === "function") {
      try {
        await viewer.requestFullscreen();
        nativeFullscreenRef.current = true;
      } catch {
        nativeFullscreenRef.current = false;
      }
    }

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(fitViewer);
    }
  }, [fitViewer]);

  const zoomAtViewportCenter = useCallback((factor) => {
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    if (!viewportRect) return;

    const point = {
      x: viewportRect.width / 2,
      y: viewportRect.height / 2
    };
    setTransform((current) => (
      zoomMermaidTransform(current, current.scale * factor, point)
    ));
  }, []);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const handleFullscreenChange = () => {
      if (document.fullscreenElement === viewerRef.current) {
        nativeFullscreenRef.current = true;
        window.requestAnimationFrame(fitViewer);
      } else if (nativeFullscreenRef.current) {
        finishClose();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") void closeViewer();
    };
    const handleResize = () => window.requestAnimationFrame(fitViewer);

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [closeViewer, finishClose, fitViewer, open]);

  useEffect(() => {
    if (!open) return undefined;

    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      setTransform((current) => (
        zoomMermaidTransform(current, current.scale * factor, point)
      ));
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(fitViewer);
    return () => window.cancelAnimationFrame(frame);
  }, [fitViewer, fullscreenSvg, open]);

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y
    };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    }));
  };

  const stopDragging = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const viewer = open && typeof document !== "undefined"
    ? createPortal(
      createElement(
        "div",
        {
          "aria-label": "Esplorazione diagramma Mermaid",
          "aria-modal": "true",
          className: "mermaid-fullscreen-viewer",
          ref: viewerRef,
          role: "dialog"
        },
        createElement(
          "div",
          {
            className: `mermaid-fullscreen-viewport${dragging ? " is-dragging" : ""}`,
            onDoubleClick: fitViewer,
            onPointerCancel: stopDragging,
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: stopDragging,
            ref: viewportRef
          },
          createElement("div", {
            className: "mermaid-fullscreen-diagram",
            "data-fitted": fitted,
            dangerouslySetInnerHTML: { __html: fullscreenSvg },
            ref: diagramRef,
            style: {
              height: `${diagramSize.height}px`,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              width: `${diagramSize.width}px`
            }
          })
        ),
        createElement(
          "div",
          { className: "mermaid-fullscreen-hint" },
          "Trascina per spostare · Rotella per zoom · Esc per uscire"
        ),
        createElement(
          "div",
          { className: "mermaid-fullscreen-controls" },
          createElement(
            "button",
            {
              "aria-label": "Riduci zoom",
              onClick: () => zoomAtViewportCenter(1 / 1.2),
              type: "button"
            },
            "−"
          ),
          createElement(
            "span",
            {
              "aria-label": `Zoom ${Math.round(transform.scale * 100)}%`,
              className: "mermaid-fullscreen-scale"
            },
            `${Math.round(transform.scale * 100)}%`
          ),
          createElement(
            "button",
            {
              "aria-label": "Aumenta zoom",
              onClick: () => zoomAtViewportCenter(1.2),
              type: "button"
            },
            "+"
          ),
          createElement(
            "button",
            {
              "aria-label": "Adatta diagramma allo schermo",
              onClick: fitViewer,
              type: "button"
            },
            "Adatta"
          ),
          createElement(
            "button",
            {
              "aria-label": "Chiudi visualizzazione a schermo intero",
              onClick: closeViewer,
              ref: closeButtonRef,
              type: "button"
            },
            "×"
          )
        )
      ),
      document.body
    )
    : null;

  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        "aria-label": "Apri diagramma Mermaid a schermo intero",
        className: "mermaid-diagram-fullscreen-trigger",
        onClick: openViewer,
        ref: triggerRef,
        type: "button"
      },
      "Fullscreen"
    ),
    viewer
  );
}
