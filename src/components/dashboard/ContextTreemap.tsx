import { useState, useRef } from "react";
import { Treemap, ResponsiveContainer } from "recharts";
import { formatTokens, CATEGORY_COLORS } from "../scan/shared";
import type { PromptScan } from "../../types";

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
  relatedFiles?: {
    name: string;
    path: string;
    tokens: number;
    color: string;
  }[];
  children?: TreemapNode[];
};

type HoverInfo = {
  name: string;
  tokens: number;
  filePath?: string;
  relatedFiles?: {
    name: string;
    path: string;
    tokens: number;
    color: string;
  }[];
  x: number;
  y: number;
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

const buildTreemapData = (scan: PromptScan): TreemapNode[] => {
  const ctx = scan.context_estimate ?? {
    system_tokens: 0,
    messages_tokens: 0,
    tools_definition_tokens: 0,
    total_tokens: 0,
  };
  const files = scan.injected_files ?? [];
  const toolResultCount = scan.tool_result_count ?? 0;
  const data: TreemapNode[] = [];

  const hasDetailedBreakdown = ctx.system_tokens > 0 || ctx.messages_tokens > 0;

  if (hasDetailedBreakdown) {
    // Claude-style detailed breakdown

    // System: broken down by injected files
    if (ctx.system_tokens > 0) {
      const fileTokens = files.reduce((sum, f) => sum + f.estimated_tokens, 0);
      const otherSystemTokens = Math.max(ctx.system_tokens - fileTokens, 0);

      const systemChildren: TreemapNode[] = files.map((f) => ({
        name: f.path.split("/").pop() ?? f.path,
        size: f.estimated_tokens,
        tokens: f.estimated_tokens,
        color: COLORS[f.category] ?? COLORS.system,
        filePath: f.path,
      }));

      if (otherSystemTokens > 100) {
        systemChildren.push({
          name: "System (other)",
          size: otherSystemTokens,
          tokens: otherSystemTokens,
          color: "#7c3aed",
        });
      }

      data.push(...systemChildren);
    }

    // Messages: split into user prompts / responses / action results
    if (ctx.messages_tokens > 0) {
      const bd = ctx.messages_tokens_breakdown;
      const hasBreakdown =
        bd &&
        (bd.user_text_tokens > 0 ||
          bd.assistant_tokens > 0 ||
          bd.tool_result_tokens > 0);

      if (hasBreakdown) {
        if (bd.assistant_tokens > 100) {
          data.push({
            name: "Responses",
            size: bd.assistant_tokens,
            tokens: bd.assistant_tokens,
            color: "#60a5fa",
          });
        }
        if (bd.user_text_tokens > 100) {
          data.push({
            name: "Your Prompts",
            size: bd.user_text_tokens,
            tokens: bd.user_text_tokens,
            color: COLORS.messages,
          });
        }
        if (bd.tool_result_tokens > 100) {
          data.push({
            name: `Action Results (${toolResultCount || ""})`.trim(),
            size: bd.tool_result_tokens,
            tokens: bd.tool_result_tokens,
            color: "#06b6d4",
          });
        }
      } else {
        data.push({
          name: "Messages",
          size: ctx.messages_tokens,
          tokens: ctx.messages_tokens,
          color: COLORS.messages,
        });
      }
    }

    // Tools Definition
    if (ctx.tools_definition_tokens > 0) {
      data.push({
        name: "Tools Def",
        size: ctx.tools_definition_tokens,
        tokens: ctx.tools_definition_tokens,
        color: COLORS.tools,
      });
    }
  } else if (ctx.total_tokens > 0) {
    // Non-Claude providers: show total input tokens as a single block
    // (no system/messages/tools breakdown available)
    data.push({
      name: "Input",
      size: ctx.total_tokens,
      tokens: ctx.total_tokens,
      color: "#3b82f6",
    });
  }

  // Filter out nodes too small to display (< 1% of total)
  const total = ctx.total_tokens || 1;
  return data.filter((d) => d.size / total >= 0.01);
};

// Custom cell renderer
type ContextCellProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  tokens: number;
  color: string;
  filePath?: string;
  onHover?: (info: HoverInfo | null) => void;
  onClick?: (filePath: string) => void;
};

const CustomContent = (props: Partial<ContextCellProps>) => {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    name = '',
    tokens = 0,
    color = '#8884d8',
    filePath,
    onHover,
    onClick,
  } = props;
  if (!width || !height || width < 4 || height < 4) return null;

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (onHover) {
      const rect = (e.currentTarget as SVGElement).closest(
        ".context-treemap-chart",
      );
      const bounds = rect?.getBoundingClientRect();
      const relX = bounds ? e.clientX - bounds.left : x;
      const relY = bounds ? e.clientY - bounds.top : y;
      onHover({ name, tokens, filePath, x: relX, y: relY });
    }
  };

  const handleMouseLeave = () => {
    if (onHover) onHover(null);
  };

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

  const showLabel = width > 50 && height > 30;
  const showTokens = width > 60 && height > 42;

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
  const chartRef = useRef<HTMLDivElement>(null);
  const data = buildTreemapData(scan);
  const files = scan.injected_files ?? [];

  if (data.length === 0) return null;

  // Build a map of file nodes: find all files matching a system-category node
  const filesByCategory = new Map<string, typeof files>();
  for (const f of files) {
    const displayName = f.path.split("/").pop() ?? f.path;
    // Each file has its own treemap cell, so the "category" is the display name
    const existing = filesByCategory.get(displayName) ?? [];
    existing.push(f);
    filesByCategory.set(displayName, existing);
  }

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
        <ResponsiveContainer width="100%" height={140}>
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

        {/* Hover tooltip */}
        {hoveredNode && (
          <div
            className="treemap-hover-tooltip"
            style={{
              position: "absolute",
              left: Math.min(
                hoveredNode.x,
                (chartRef.current?.offsetWidth ?? 300) - 180,
              ),
              top: Math.max(hoveredNode.y - 8, 0),
              transform: "translateY(-100%)",
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
      </div>

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
