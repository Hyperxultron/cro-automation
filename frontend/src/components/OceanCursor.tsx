import { useEffect, useRef } from "react";

// Ocean Pro cursor: a small dot that follows the mouse exactly, and a soft ring
// that trails behind it and grows over anything clickable. Normal cursor stays
// in text fields. Off on touch screens and for "reduce motion" users.

const CLICKABLE =
    'a, button, select, summary, label, [role="button"], [role="tab"], [role="link"], [role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="submit"], input[type="button"], .cursor-pointer, [data-cursor="hover"]';
const TEXT_FIELD =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]';

export default function OceanCursor() {
    const dotRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (!fine.matches || reduce.matches) return;

        const dot = dotRef.current;
        const ring = ringRef.current;
        if (!dot || !ring) return;

        const root = document.documentElement;
        root.classList.add("ocean-cursor-on");

        let x = -100, y = -100, rx = -100, ry = -100;
        let raf = 0;
        let visible = false;

        const tick = () => {
            rx += (x - rx) * 0.2;
            ry += (y - ry) * 0.2;
            ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
            if (Math.abs(x - rx) > 0.1 || Math.abs(y - ry) > 0.1) raf = requestAnimationFrame(tick);
            else raf = 0;
        };

        const setState = (target: Element | null) => {
            const el = target instanceof Element ? target : null;
            const text = !!el?.closest(TEXT_FIELD);
            const hover = !text && !!el?.closest(CLICKABLE);
            const chart = !text && !hover && el?.tagName === "CANVAS";
            root.classList.toggle("ocean-cursor-text", text);
            ring.dataset.state = hover ? "hover" : chart ? "chart" : "";
        };

        const onMove = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            x = e.clientX;
            y = e.clientY;
            dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            if (!visible) {
                visible = true;
                rx = x;
                ry = y;
                root.classList.add("ocean-cursor-visible");
            }
            setState(e.target as Element);
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const onDown = () => ring.classList.add("is-down");
        const onUp = () => ring.classList.remove("is-down");
        const onLeave = () => {
            visible = false;
            root.classList.remove("ocean-cursor-visible");
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerdown", onDown, { passive: true });
        window.addEventListener("pointerup", onUp, { passive: true });
        document.addEventListener("mouseleave", onLeave);
        window.addEventListener("blur", onLeave);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointerup", onUp);
            document.removeEventListener("mouseleave", onLeave);
            window.removeEventListener("blur", onLeave);
            root.classList.remove("ocean-cursor-on", "ocean-cursor-visible", "ocean-cursor-text");
        };
    }, []);

    return (
        <>
            <div ref={ringRef} className="ocean-cursor-ring" aria-hidden="true"><span /></div>
            <div ref={dotRef} className="ocean-cursor-dot" aria-hidden="true"><span /></div>
        </>
    );
}
