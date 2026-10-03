import { useRef, type PointerEvent } from "react";
import { useT } from "../i18n";
import type { BoundarySegment, FacePlacement, Point2 } from "../interaction/holePlacement";

function closestPoint(point: Point2, edge: BoundarySegment): Point2 {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 1e-12
    ? 0
    : Math.max(0, Math.min(1, ((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / lengthSquared));
  return { x: edge.a.x + dx * t, y: edge.a.y + dy * t };
}

function formatMm(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : "?";
}

export function HolePlacementPreview({
  face,
  point,
  diameterMm,
  valid,
  selectedEdgeIds,
  dimensions,
  onPointChange,
  onToggleEdge,
}: {
  face: FacePlacement;
  point: Point2;
  diameterMm: number | null;
  valid: boolean;
  selectedEdgeIds: string[];
  dimensions: { edgeId: string; distanceMm: number }[];
  onPointChange: (point: Point2) => void;
  onToggleEdge: (edgeId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerId = useRef<number | null>(null);
  const t = useT();
  const width = Math.max(face.bounds.maxX - face.bounds.minX, 1);
  const height = Math.max(face.bounds.maxY - face.bounds.minY, 1);
  const margin = Math.max(width, height) * 0.08;
  const viewBox = `${face.bounds.minX - margin} ${-face.bounds.maxY - margin} ${width + margin * 2} ${height + margin * 2}`;
  const crosshair = Math.max(Math.min(width, height) * 0.035, 1);
  const radius = diameterMm && diameterMm > 0 ? diameterMm / 2 : 0;
  const visiblePoint = `${formatMm(point.x)}, ${formatMm(point.y)}`;

  const localPoint = (event: PointerEvent<SVGSVGElement>): Point2 | null => {
    const svg = svgRef.current;
    const transform = svg?.getScreenCTM();
    if (!svg || !transform) return null;
    const source = svg.createSVGPoint();
    source.x = event.clientX;
    source.y = event.clientY;
    const converted = source.matrixTransform(transform.inverse());
    return Number.isFinite(converted.x) && Number.isFinite(converted.y)
      ? { x: converted.x, y: -converted.y }
      : null;
  };

  const movePoint = (event: PointerEvent<SVGSVGElement>): void => {
    const next = localPoint(event);
    if (next) onPointChange(next);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="mt-2 h-56 w-full touch-none rounded-md border border-white/10 bg-slate-950/70"
      data-testid="hole-placement-preview"
      role="group"
      aria-label={t("hole.previewAria")}
      aria-describedby="hole-placement-help"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest("[data-boundary-edge]")) return;
        event.preventDefault();
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        movePoint(event);
      }}
      onPointerMove={(event) => {
        if (pointerId.current === event.pointerId) movePoint(event);
      }}
      onPointerUp={(event) => {
        if (pointerId.current !== event.pointerId) return;
        pointerId.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { pointerId.current = null; }}
      onLostPointerCapture={() => { pointerId.current = null; }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 1;
        const delta = event.key === "ArrowRight" ? { x: step, y: 0 }
          : event.key === "ArrowLeft" ? { x: -step, y: 0 }
          : event.key === "ArrowUp" ? { x: 0, y: step }
          : event.key === "ArrowDown" ? { x: 0, y: -step }
          : null;
        if (!delta) return;
        event.preventDefault();
        onPointChange({ x: point.x + delta.x, y: point.y + delta.y });
      }}
    >
      <g aria-hidden="true">
        {face.triangles.map(([a, b, c], index) => (
          <polygon
            key={index}
            points={`${a.x},${-a.y} ${b.x},${-b.y} ${c.x},${-c.y}`}
            fill="#4c78b8"
            fillOpacity="0.18"
            stroke="#91b7ec"
            strokeOpacity="0.3"
            strokeWidth="0.15"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {face.boundaryEdges.map((edge) => (
        <line
          key={edge.id}
          x1={edge.a.x}
          y1={-edge.a.y}
          x2={edge.b.x}
          y2={-edge.b.y}
          stroke="#dbeafe"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          aria-hidden="true"
        />
      ))}

      {face.measureEdges.map((edge, index) => {
        const selected = selectedEdgeIds.includes(edge.id);
        return (
          <g
            key={edge.id}
            data-boundary-edge
            data-testid={`hole-boundary-edge-${edge.id}`}
            data-direction={Math.abs(edge.b.x - edge.a.x) >= Math.abs(edge.b.y - edge.a.y) ? "horizontal" : "vertical"}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={t("hole.selectBoundary", { n: index + 1 })}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) onToggleEdge(edge.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onToggleEdge(edge.id);
            }}
            style={{ cursor: "pointer" }}
          >
            <title>{t("hole.selectBoundary", { n: index + 1 })}</title>
            <line
              x1={edge.a.x}
              y1={-edge.a.y}
              x2={edge.b.x}
              y2={-edge.b.y}
              stroke="transparent"
              strokeWidth="12"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={edge.a.x}
              y1={-edge.a.y}
              x2={edge.b.x}
              y2={-edge.b.y}
              stroke={selected ? "#fbbf24" : "#e5edf9"}
              strokeWidth={selected ? "3" : "1.8"}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      })}

      {dimensions.map(({ edgeId, distanceMm }, index) => {
        const edge = face.measureEdges.find((candidate) => candidate.id === edgeId);
        if (!edge) return null;
        const end = closestPoint(point, edge);
        const midpoint = { x: (point.x + end.x) / 2, y: -(point.y + end.y) / 2 };
        return (
          <g key={`${edgeId}-${index}`} aria-hidden="true">
            <line
              x1={point.x}
              y1={-point.y}
              x2={end.x}
              y2={-end.y}
              stroke="#fbbf24"
              strokeWidth="1.6"
              strokeDasharray="2 1"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={end.x} cy={-end.y} r={Math.max(Math.min(width, height) * 0.006, 0.35)} fill="#fbbf24" />
            <text x={midpoint.x} y={midpoint.y} fill="#fde68a" fontSize={Math.max(Math.min(width, height) * 0.035, 1.8)} textAnchor="middle">
              d{index + 1} {formatMm(distanceMm)} mm
            </text>
          </g>
        );
      })}

      {radius > 0 && (
        <circle
          data-testid="hole-placement-circle"
          cx={point.x}
          cy={-point.y}
          r={radius}
          fill={valid ? "#60a5fa" : "#f87171"}
          fillOpacity="0.3"
          stroke={valid ? "#93c5fd" : "#fca5a5"}
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
          aria-label={t("hole.position")}
        />
      )}
      <g aria-label={t("hole.previewPoint", { x: formatMm(point.x), y: formatMm(point.y) })}>
        <line
          x1={point.x - crosshair}
          y1={-point.y}
          x2={point.x + crosshair}
          y2={-point.y}
          stroke={valid ? "#dbeafe" : "#fecaca"}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={point.x}
          y1={-point.y - crosshair}
          x2={point.x}
          y2={-point.y + crosshair}
          stroke={valid ? "#dbeafe" : "#fecaca"}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={point.x + crosshair * 1.3}
          y={-point.y - crosshair * 1.3}
          fill="#e2e8f0"
          fontSize={Math.max(Math.min(width, height) * 0.04, 2)}
        >
          {visiblePoint}
        </text>
      </g>
    </svg>
  );
}
