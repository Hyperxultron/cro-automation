import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import {
    DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, MarkPointComponent,
    TooltipComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

// Only the pieces we use, to keep the download small.
echarts.use([
    BarChart, HeatmapChart, LineChart, PieChart,
    DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, MarkPointComponent,
    TooltipComponent, VisualMapComponent, CanvasRenderer,
]);

// Ocean Pro chart colours (from the approved design). Light and dark sets;
// charts redraw when the theme toggle flips <html data-theme>.
export const OCEAN = {
    light: {
        main: "#0284c7", cat: ["#0284c7", "#f59e0b", "#0d9488", "#7c3aed", "#db2777", "#94a3b8"],
        text: "#0b2239", muted: "#5b7088", grid: "#e8eff6", axis: "#dbe6f0", surface: "#ffffff",
        tip: "#ffffff", tipBorder: "#dbe6f0", prev: "#94a9bd",
        seq: ["#e0f2fe", "#7dd3fc", "#0284c7", "#0c4a6e"], mark: "#f59e0b",
    },
    dark: {
        main: "#38bdf8", cat: ["#0284c7", "#d97706", "#0d9488", "#8b5cf6", "#db2777", "#64748b"],
        text: "#e2f0f9", muted: "#86a3b8", grid: "#12324d", axis: "#14304a", surface: "#0a1e2f",
        tip: "#0f2840", tipBorder: "#1d4466", prev: "#557590",
        seq: ["#0c2a40", "#075985", "#0ea5e9", "#bae6fd"], mark: "#d97706",
    },
};
export type OceanTokens = (typeof OCEAN)["light"];
export const FONT = "'Space Grotesk', 'Geist Variable', system-ui, sans-serif";

export function useOceanTheme(): OceanTokens {
    const read = () => (document.documentElement.dataset.theme === "dark" ? OCEAN.dark : OCEAN.light);
    const [tok, setTok] = useState<OceanTokens>(read);
    useEffect(() => {
        const obs = new MutationObserver(() => setTok(read()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        return () => obs.disconnect();
    }, []);
    return tok;
}

export const tipBase = (t: OceanTokens) => ({
    backgroundColor: t.tip,
    borderColor: t.tipBorder,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: t.text, fontFamily: FONT, fontSize: 12 },
    extraCssText: "border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12);",
});

// Small React wrapper: one ECharts instance per div, resized with its box.
function EChart({ option, height, onEvents }: {
    option: EChartsOption;
    height: number;
    onEvents?: Record<string, (p: unknown) => void>;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const chart = useRef<echarts.ECharts | null>(null);

    useEffect(() => {
        if (!ref.current) return;
        const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
        chart.current = c;
        const ro = new ResizeObserver(() => c.resize());
        ro.observe(ref.current);
        return () => {
            ro.disconnect();
            c.dispose();
            chart.current = null;
        };
    }, []);

    useEffect(() => {
        chart.current?.setOption(option, { notMerge: true });
    }, [option]);

    useEffect(() => {
        const c = chart.current;
        if (!c || !onEvents) return;
        Object.entries(onEvents).forEach(([name, fn]) => c.on(name, fn));
        return () => Object.keys(onEvents).forEach((name) => c.off(name));
    }, [onEvents]);

    return <div ref={ref} style={{ width: "100%", height }} />;
}

export default EChart;
