"use client";

import { useEffect, useState } from "react";

type TooltipState = {
  text: string;
  x: number;
  y: number;
  visible: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function helpTextFrom(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-help]")?.dataset.help || null;
}

export function GlobalHelpTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState>({ text: "", x: 0, y: 0, visible: false });

  useEffect(() => {
    function hide() {
      setTooltip((current) => ({ ...current, visible: false }));
    }

    function place(x: number, y: number) {
      const offset = 18;
      const width = 300;
      const height = 96;
      return {
        x: clamp(x + offset, 10, window.innerWidth - width - 10),
        y: clamp(y + offset, 10, window.innerHeight - height - 10)
      };
    }

    function show(text: string, x: number, y: number) {
      const next = place(x, y);
      setTooltip({ text, x: next.x, y: next.y, visible: true });
    }

    function onMouseOver(event: MouseEvent) {
      const text = helpTextFrom(event.target);
      if (!text) return;
      show(text, event.clientX, event.clientY);
    }

    function onMouseMove(event: MouseEvent) {
      const text = helpTextFrom(event.target);
      if (!text) return;
      const next = place(event.clientX, event.clientY);
      setTooltip({ text, x: next.x, y: next.y, visible: true });
    }

    function onMouseOut(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest("[data-help]") : null;
      const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-help]") : null;
      if (target && target === related) return;
      hide();
    }

    function onFocusIn(event: FocusEvent) {
      const text = helpTextFrom(event.target);
      if (!text || !(event.target instanceof HTMLElement)) return;
      const rect = event.target.getBoundingClientRect();
      show(text, rect.left + rect.width / 2, rect.bottom);
    }

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);

    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("click", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tooltip.visible || !tooltip.text) return null;

  return (
    <div
      className="ui-font fixed z-[9999] max-w-[280px] rounded-md border border-paper/20 bg-ink px-3 py-2 text-xs font-bold leading-snug text-paper shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
      style={{ left: tooltip.x, top: tooltip.y, pointerEvents: "none" }}
      role="tooltip"
    >
      {tooltip.text}
    </div>
  );
}
