import { useState, useRef, useEffect } from "react";
import { Treemap, ResponsiveContainer } from "recharts";
import { formatTokens, CATEGORY_COLORS } from "../scan/shared";
import { clampTooltipX } from "../../utils/tooltipPlacement";
import type { PromptScan } from "../../types";

const TREEMAP_TOOLTIP_HALF_WIDTH = 90;
const TREEMAP_TOOLTIP_HEIGHT = 48;

type ContextTreemapProps = {
  scan: PromptScan;
  onFileClick?: (filePath: string) => void;
};

type TreemapNode = {
  name: string;
  size: number;
  tokens: number;
  color: string;
  filePath?: string;
  children?: TreemapNode[];
};

type HoverInfo = {
  name: string;
  tokens: number;
  filePath?: string;
  x: number;
  y: number;
};

type GroupLabel = {
  name: string;
  tokens: number;
  left: number;
  top: number;
};

const COLORS: Record<string, string> = {
  system: "#8b5cf6",
  messages: "#3b82f6",
  tools: "#f59e0b",
  global: CATEGORY_COLORS.global,
  project: CATEGORY_COLORS.project,
  rules: CATEGORY_COLORS.rules,
  memory: CATEGORY_COLORS.memory,
  skill: CATEGORY_COLORS.skill,
};

const GROUP_NAMES = new Set(["Injected", "Actions"]);

const buildTreemapData = (scan: PromptScan): TreemapNode[] => {
  const ctx = scan.context_estimate ?? {
    system_tokens: 0,
    messages_tokens: 0,
    tools_definition_tokens: 0,
    total_tokens: 0,
  };
  const files = scan.injected_files ?? [];
  const toolResultCount = scan.tool_result_count ?? 0;
  const total = ctx.total_tokens || 1;
  const minSize = total * 0.01;

  const hasDetailedBreakdown = ctx.system_tokens > 0 || ctx.messages_tokens > 0;

  if (!hasDetailedBreakdown) {
    if (ctx.total_tokens > 0) {
      return [{
        name: "Input",
        size: ctx.total_tokens,
        tokens: ctx.total_tokens,
        color: "#3b82f6",
      }];
    }
    return [];
  }

  const injectedChildren: TreemapNode[] = [];
  const actionsChildren: TreemapNode[] = [];

  if (ctx.system_tokens > 0) {
    const fileTokens = files.reduce((sum, f) => sum + f.estimated_tokens, 0);
    const otherSystemTokens = Math.max(ctx.system_tokens - fileTokens, 0);

    for (const f of files) {
      if (f.estimated_tokens >= minSize) {
        injectedChildren.push({
          name: f.path.split("/").pop() ?? f.path,
          size: f.estimated_tokens,
          tokens: f.estimated_tokens,
          color: COLORS[f.category] ?? COLORS.system,
          filePath: f.path,
        });
      }
    }

    if (otherSystemTokens > minSize) {
      injectedChildren.push({
        name: "System (other)",
        size: otherSystemTokens,
        tokens: otherSystemTokens,
        color: "#7c3aed",
      });
    }
  }

  if (ctx.messages_tokens > 0) {
    const bd = ctx.messages_tokens_breakdown;
    const hasBreakdown =
      bd &&
      (bd.user_text_tokens > 0 ||
        bd.assistant_tokens > 0 ||
        bd.tool_result_tokens > 0);

    if (hasBreakdown) {
      if (bd.assistant_tokens > minSize) {
        actionsChildren.push({
          name: "Responses",
          size: bd.assistant_tokens,
          tokens: bd.assistant_tokens,
          color: "#60a5fa",
        });
      }
      if (bd.user_text_tokens > minSize) {
        actionsChildren.push({
          name: "Your Prompts",
          size: bd.user_text_tokens,
          tokens: bd.user_text_tokens,
          color: COLORS.messages,
        });
      }
      if (bd.tool_result_tokens > minSize) {
        actionsChildren.push({
          name: `Action Results (${toolResultCount || ""})`.trim(),
          size: bd.tool_result_tokens,
          tokens: bd.tool_result_tokens,
          color: "#06b6d4",
        });
      }
    } else {
      actionsChildren.push({
        name: "Messages",
        size: ctx.messages_tokens,
        tokens: ctx.messages_tokens,
        color: COLORS.messages,
      });
    }
  }

  if (ctx.tools_definition_tokens > minSize) {
    actionsChildren.push({
      name: "Tools Def",
      size: ctx.tools_definition_tokens,
      tokens: ctx.tools_definition_tokens,
      color: COLORS.tools,
    });
  }

  const data: TreemapNode[] = [];

  if (injectedChildren.length > 0) {
    const injectedTotal = injectedChildren.reduce((s, c) => s + c.tokens, 0);
    data.push({
      name: "Injected",
      size: injectedTotal,
      tokens: injectedTotal,
      color: "#8b5cf6",
      children: injectedChildren,
    });
  }

  if (actionsChildren.length > 0) {
    const actionsTotal = actionsChildren.reduce((s, c) => s + c.tokens, 0);
    data.push({
      name: "Actions",
      size: actionsTotal,
      tokens: actionsTotal,
      color: "#3b82f6",
      children: actionsChildren,
    });
  }

  return data;
};

// Cell renderer
type CellProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  name: string;
  tokens: number;
  color: string;
  filePath?: string;
  onHover?: (info: HoverInfo | null) => void;
  onClick?: (filePath: string) => void;
};

const CustomContent = (props: Partial<CellProps>) => {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth = 1,
    name = "",
    tokens = 0,
    color = "#8884d8",
    filePath,
    onHover,
    onClick,
  } = props;

  if (!width || !height || width < 2 || height < 2) return null;

  const isGroup = depth === 1 && GROUP_NAMES.has(name);

  if (isGroup) {
    // Group parent: render an invisible marker rect with data attributes for DOM query
    return (
      <rect
        data-group={name}
        data-tokens={tokens}
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth={2}
        rx={6}
        ry={6}
      />
    );
  }

  // Leaf nodes
  const handleMouseEnter = (e: React.MouseEvent) => {
    if (onHover) {
      onHover({ name, tokens, filePath, x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseLeave = () => onHover?.(null);
  const handleClick = () => {
    if (onClick && filePath) onClick(filePath);
  };

  if (width < 20 || height < 20) {
    return (
      <g
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ cursor: filePath ? "pointer" : "default" }}
      >
        <rect
          x={x + 1}
          y={y + 1}
          width={Math.max(width - 2, 0)}
          height={Math.max(height - 2, 0)}
          rx={4}
          ry={4}
          fill={color}
          fillOpacity={0.85}
          stroke="none"
        />
      </g>
    );
  }

  const showLabel = width > 50 && height > 28;
  const showTokens = width > 60 && height > 40;

  return (
    <g
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{ cursor: filePath ? "pointer" : "default" }}
    >
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        rx={4}
        ry={4}
        fill={color}
        fillOpacity={0.85}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={0.5}
      />
      {showLabel && (
        <text
          x={x + 6}
          y={y + 16}
          fill="#fff"
          fontSize={11}
          fontWeight={600}
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          style={{ pointerEvents: "none" }}
        >
          {name.length > width / 7
            ? name.slice(0, Math.floor(width / 7)) + "…"
            : name}
        </text>
      )}
      {showTokens && (
        <text
          x={x + 6}
          y={y + 30}
          fill="rgba(255,255,255,0.75)"
          fontSize={10}
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          style={{ pointerEvents: "none" }}
        >
          {formatTokens(tokens)}
        </text>
      )}
    </g>
  );
};

export const ContextTreemap = ({ scan, onFileClick }: ContextTreemapProps) => {
  const [hoveredNode, setHoveredNode] = useState<HoverInfo | null>(null);
  const [groupLabels, setGroupLabels] = useState<GroupLabel[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const data = buildTreemapData(scan);
  const files = scan.injected_files ?? [];

  // After treemap renders, read group rect positions from the DOM
  const prevLabelsRef = useRef<string>("");
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const rects = el.querySelectorAll<SVGRectElement>("rect[data-group]");
    const labels: GroupLabel[] = [];
    rects.forEach((rect) => {
      const name = rect.getAttribute("data-group") ?? "";
      const tokens = Number(rect.getAttribute("data-tokens") ?? 0);
      const x = Number(rect.getAttribute("x") ?? 0);
      const y = Number(rect.getAttribute("y") ?? 0);
      labels.push({ name, tokens, left: x + 4, top: y + 3 });
    });
    const key = labels.map((l) => `${l.name}:${l.left}:${l.top}`).join("|");
    if (key !== prevLabelsRef.current) {
      prevLabelsRef.current = key;
      setGroupLabels(labels);
    }
  });

  if (data.length === 0) return null;

  const handleCellClick = (filePath: string) => {
    if (onFileClick) onFileClick(filePath);
  };

  return (
    <div className="context-treemap">
      <div className="context-treemap-title">Context Window</div>
      <div
        className="context-treemap-chart"
        ref={chartRef}
        style={{ position: "relative" }}
      >
        <ResponsiveContainer width="100%" height={160}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="none"
            content={
              <CustomContent
                onHover={setHoveredNode}
                onClick={handleCellClick}
              />
            }
            isAnimationActive={false}
          />
        </ResponsiveContainer>

        {/* Group label overlays — HTML on top of SVG */}
        {groupLabels.map((g) => (
          <div
            key={g.name}
            style={{
              position: "absolute",
              left: g.left,
              top: g.top,
              pointerEvents: "none",
              background: "rgba(0,0,0,0.45)",
              color: "#fff",
              fontSize: 9,
              fontWeight: 600,
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              padding: "2px 6px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.4px",
              lineHeight: "1.2",
              zIndex: 5,
            }}
          >
            {g.name} · {formatTokens(g.tokens)}
          </div>
        ))}

      </div>
      {hoveredNode && (
        <div
          className="treemap-hover-tooltip"
          style={{
            position: "fixed",
            left: clampTooltipX({
              targetX: hoveredNode.x,
              halfWidth: TREEMAP_TOOLTIP_HALF_WIDTH,
              viewportWidth: window.innerWidth,
            }),
            top: Math.max(hoveredNode.y - 8, TREEMAP_TOOLTIP_HEIGHT + 4),
            transform: "translate(-50%, -100%)",
            pointerEvents: "none",
          }}
        >
          <div className="treemap-tooltip-name">{hoveredNode.name}</div>
          <div className="treemap-tooltip-tokens">
            {formatTokens(hoveredNode.tokens)}
          </div>
          {hoveredNode.filePath && (
            <div className="treemap-tooltip-hint">Click to view file</div>
          )}
        </div>
      )}

      {/* Clickable file list below treemap */}
      {files.length > 0 && (
        <div className="treemap-file-list">
          {files.map((f, i) => (
            <button
              key={i}
              className="treemap-file-item"
              onClick={() => onFileClick?.(f.path)}
            >
              <span
                className="treemap-file-dot"
                style={{ background: COLORS[f.category] ?? COLORS.system }}
              />
              <span className="treemap-file-name">
                {f.path.split("/").pop()}
              </span>
              <span className="treemap-file-tokens">
                {formatTokens(f.estimated_tokens)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
