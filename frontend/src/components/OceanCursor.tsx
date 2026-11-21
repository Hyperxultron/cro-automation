import { useEffect, useRef } from "react";

// Comet Trail cursor: a teal dot that follows the mouse exactly, with a tail of
// smaller fading dots behind it. Over anything clickable the dot becomes a ring. Normal cursor stays
// in text fields. Off on touch screens and for "reduce motion" users.

const CLICKABLE =
    'a, button, select, summary, label, [role="button"], [role="tab"], [role="link"], [role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="submit"], input[type="button"], .cursor-pointer, [data-cursor="hover"]';
const TEXT_FIELD =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]';

export default function OceanCursor() {
    const headRef = useRef<HTMLDivElement>(null);
    const tailRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (!fine.matches || reduce.matches) return;

        const head = headRef.current;
        const tail = tailRefs.current.filter(Boolean) as HTMLDivElement[];
        if (!head || !tail.length) return;

        const root = document.documentElement;
        root.classList.add("ocean-cursor-on");

        let x = -100, y = -100;
        const pts = tail.map(() => ({ x: -100, y: -100 }));
        let raf = 0;
        let visible = false;

        // Each tail dot chases the one in front of it -> a smooth comet tail.
        const tick = () => {
            let px = x, py = y, moving = false;
            pts.forEach((p, i) => {
                p.x += (px - p.x) * 0.42;
                p.y += (py - p.y) * 0.42;
                if (Math.abs(px - p.x) > 0.15 || Math.abs(py - p.y) > 0.15) moving = true;
                tail[i].style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
                px = p.x;
                py = p.y;
            });
            raf = moving ? requestAnimationFrame(tick) : 0;
        };

        const setState = (target: Element | null) => {
            const el = target instanceof Element ? target : null;
            const text = !!el?.closest(TEXT_FIELD);
            const hover = !text && !!el?.closest(CLICKABLE);
            root.classList.toggle("ocean-cursor-text", text);
            root.classList.toggle("ocean-cursor-hover", hover);
        };

        const onMove = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            x = e.clientX;
            y = e.clientY;
            head.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            if (!visible) {
                visible = true;
                pts.forEach((p) => { p.x = x; p.y = y; });
                root.classList.add("ocean-cursor-visible");
            }
            setState(e.target as Element);
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const onDown = () => root.classList.add("ocean-cursor-down");
        const onUp = () => root.classList.remove("ocean-cursor-down");
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
            root.classList.remove("ocean-cursor-on", "ocean-cursor-visible", "ocean-cursor-text", "ocean-cursor-hover", "ocean-cursor-down");
        };
    }, []);

    return (
        <div className="comet-cursor" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} ref={(el) => { tailRefs.current[i] = el; }} className="comet-tail" style={{ ["--i" as string]: i }}><span /></div>
            ))}
            <div ref={headRef} className="comet-head"><span /></div>
        </div>
    );
}
