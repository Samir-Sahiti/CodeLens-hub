import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const PRETICK_FULL = 300;
const PRETICK_CLUSTERED = 150;
const TOUR_VIOLET = '#a78bfa';
const TOUR_VIOLET_RGBA = 'rgba(167, 139, 250, 0.95)';

function getNodeAtPoint(nodes, point) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const dx = point[0] - node.x;
    const dy = point[1] - node.y;
    if (Math.sqrt((dx * dx) + (dy * dy)) <= node.radius + 2) {
      return node;
    }
  }

  return null;
}

// Interpolate between two hex colours by factor t ∈ [0,1]
function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bv).toString(16).slice(1)}`;
}

function hotspotColor(score) {
  // green (#22c55e) → yellow (#eab308) → red (#ef4444)
  if (score <= 0.5) return lerpColor('#22c55e', '#eab308', score * 2);
  return lerpColor('#eab308', '#ef4444', (score - 0.5) * 2);
}

export function useGraphSimulation({
  containerRef,
  svgRef,
  canvasRef,
  nodes,
  edges,
  renderMode,
  selection,
  impactAnalysis,
  attackSurface,
  tour,
  hotspotMode,
  coverageMode,
  focusNodeId,
  onNodeClick,
  onNodeContextMenu,
  onNodeDoubleClick,
  onBackgroundClick,
}) {
  const zoomBehaviorRef = useRef(null);
  const canvasTransformRef = useRef(d3.zoomIdentity);
  const resetViewRef = useRef(() => {});
  const tourPulseRef = useRef({ activeStepIndex: null, startedAt: 0 });

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isGraphVisible, setIsGraphVisible] = useState(true);
  const [simulation, setSimulation] = useState(null);

  // Track whether we have nodes - used to re-trigger observer setup
  // when the container element first appears in the DOM
  const hasNodes = nodes.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateSize = () => {
      const nextWidth = Math.max(container.clientWidth, 320);
      const nextHeight = Math.max(container.clientHeight, 320);
      setDimensions((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
      if (zoomBehaviorRef.current) {
        const target = renderMode === 'canvas' ? d3.select(canvasRef.current) : d3.select(svgRef.current);
        target.call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [canvasRef, containerRef, renderMode, svgRef, hasNodes]);















  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new IntersectionObserver((entries) => {
      setIsGraphVisible(entries[0].isIntersecting);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    if (!simulation) return;

    if (isGraphVisible) {
      simulation.alphaTarget(0.3).restart(); // resume
    } else {
      simulation.alphaTarget(0); // pause
    }
  }, [isGraphVisible, simulation]);

  const layoutCacheRef = useRef(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  // --- 1. Compute Graph Layout Only When Topology Changes ---
  useEffect(() => {
    let width = dimensions.width;
    let height = dimensions.height;

    // Fallback if ResizeObserver hasn't fired yet
    if ((!width || !height) && containerRef.current) {
      width = Math.max(containerRef.current.clientWidth, 320);
      height = Math.max(containerRef.current.clientHeight, 320);
    }

    if (!width || !height || nodes.length === 0) {
      return undefined;
    }

    const localNodes = nodes.map((node) => ({
      ...node,
      x: width / 2,
      y: height / 2,
    }));
    const localLinks = edges.map((edge) => ({ ...edge }));
    const maxIncoming = Math.max(1, ...nodes.map((n) => n.incoming_count || 0));

    const pretickCount = nodes.length < 100 ? PRETICK_CLUSTERED : PRETICK_FULL;

    const simulation = d3.forceSimulation(localNodes)
      .force('link', d3.forceLink(localLinks).id((node) => node.graphId).distance((link) => {
        const targetRadius = typeof link.target === 'object' ? link.target.radius : 14;
        return Math.max(40, 50 + targetRadius);
      }))
      .force('charge', d3.forceManyBody().strength(-400).distanceMax(250))
      .force('x', d3.forceX(width / 2).strength(0.18))
      .force('y', d3.forceY(height / 2).strength(0.18))
      .force('collide', d3.forceCollide().radius((node) => node.radius + 35).iterations(3))
      ;
    setSimulation(simulation);

    for (let tick = 0; tick < pretickCount; tick += 1) {
      simulation.tick();
    }

    layoutCacheRef.current = {
      localNodes,
      localLinks,
      maxIncoming,
      width,
      height,
    };

    setLayoutVersion((v) => v + 1);

    return () => {
      simulation.stop();
    };
  }, [containerRef, dimensions, nodes, edges]);

  // --- 2. Draw Graph Based on Cached Layout ---
  useEffect(() => {
    if (!layoutCacheRef.current || nodes.length === 0) return undefined;
    const { localNodes, localLinks, maxIncoming, width, height } = layoutCacheRef.current;

    const highlightedNodeIds = selection.highlightedNodeIds;
    const highlightedEdgeIds = selection.highlightedEdgeIds;
    const isSelectionActive = selection.isActive;
    const isImpactActive = Boolean(impactAnalysis);
    const directImpactIds = new Set(impactAnalysis?.directIds || []);
    const transitiveImpactIds = new Set(impactAnalysis?.transitiveIds || []);
    const impactedNodeIds = new Set([
      impactAnalysis?.sourceId,
      ...directImpactIds,
      ...transitiveImpactIds,
    ].filter(Boolean));

    const isHotspotActive = Boolean(hotspotMode?.isActive);
    const hotspotScores   = hotspotMode?.scores || new Map();
    const isCoverageActive = Boolean(coverageMode?.isActive);

    const isTourActive = Boolean(tour?.isActive);
    const tourStepNodeIds = tour?.stepNodeIds || new Set();
    const tourStepsByNodeId = tour?.stepsByNodeId || new Map();
    const tourOrderedStepNodeIds = tour?.orderedStepNodeIds || [];
    const activeTourStepIndex = tour?.activeStepIndex ?? null;
    const activeTourNodeId = (() => {
      if (!isTourActive) return null;
      for (const steps of tourStepsByNodeId.values()) {
        const activeStep = steps.find((step) => step.stepIndex === activeTourStepIndex);
        if (activeStep) return activeStep.nodeId;
      }
      return null;
    })();
    if (isTourActive && tourPulseRef.current.activeStepIndex !== activeTourStepIndex) {
      tourPulseRef.current = { activeStepIndex: activeTourStepIndex, startedAt: Date.now() };
    }

    const isAttackSurfaceActive = Boolean(attackSurface?.isActive);
    const asSourceIds   = attackSurface?.sourceIds   || new Set();
    const asSinkIds     = attackSurface?.sinkIds     || new Set();
    const asBothIds     = attackSurface?.bothIds     || new Set();
    const asPathNodeIds = attackSurface?.pathNodeIds || new Set();
    const asPathEdgeIds = attackSurface?.pathEdgeIds || new Set();
    const hasPathHighlight = asPathNodeIds.size > 0;

    const tourOverlayEdges = [];
    for (let index = 0; index < tourOrderedStepNodeIds.length - 1; index += 1) {
      const source = localNodes.find((node) => node.graphId === tourOrderedStepNodeIds[index]);
      const target = localNodes.find((node) => node.graphId === tourOrderedStepNodeIds[index + 1]);
      if (!source || !target || source.graphId === target.graphId) continue;
      tourOverlayEdges.push({
        id: `tour-${index}-${source.graphId}->${target.graphId}`,
        source,
        target,
      });
    }

    const getTourStepBadge = (nodeId) => {
      const steps = tourStepsByNodeId.get(nodeId);
      if (!steps?.length) return null;
      const activeStep = steps.find((step) => step.stepIndex === activeTourStepIndex);
      const step = activeStep || steps[0];
      const stepOrder = Number.isFinite(step.stepOrder) ? step.stepOrder : step.step_order;
      return Number.isFinite(stepOrder) ? stepOrder : step.stepIndex + 1;
    };

    const getTourNodeRadius = (node) => {
      if (!isTourActive || !tourStepNodeIds.has(node.graphId)) return node.radius;
      return node.radius + (node.graphId === activeTourNodeId ? 4 : 2);
    };

    const isTourPulseActive = () => isTourActive && Date.now() - tourPulseRef.current.startedAt < 1000;

    const getNodeOpacity = (nodeId) => {
      if (isTourActive) {
        return tourStepNodeIds.has(nodeId) ? 1 : 0.12;
      }
      if (isCoverageActive) {
        const node = localNodes.find((n) => n.graphId === nodeId);
        return node?.is_test_file ? 0.3 : 1;
      }
      if (isHotspotActive) return 1; // every node is coloured — none are dimmed
      if (isAttackSurfaceActive) {
        if (asSourceIds.has(nodeId) || asSinkIds.has(nodeId) || asBothIds.has(nodeId)) return 1;
        if (asPathNodeIds.has(nodeId)) return 1;
        return hasPathHighlight ? 0.08 : 0.12;
      }
      if (isImpactActive) {
        return impactedNodeIds.has(nodeId) ? 1 : 0.12;
      }
      return !isSelectionActive || highlightedNodeIds.has(nodeId) ? 1 : 0.15;
    };

    const getEdgeOpacity = (edge) => {
      if (isTourActive) return 0.08;
      if (isAttackSurfaceActive) {
        if (hasPathHighlight) {
          return asPathEdgeIds.has(edge.id) ? 0.9 : 0.06;
        }
        return 0.12;
      }
      if (isImpactActive) {
        const sourceId = typeof edge.source === 'object' ? edge.source.graphId : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.graphId : edge.target;
        return impactedNodeIds.has(sourceId) && impactedNodeIds.has(targetId) ? 0.75 : 0.08;
      }
      return !isSelectionActive || highlightedEdgeIds.has(edge.id) ? 0.9 : 0.15;
    };

    const getNodeFill = (node) => {
      if (isTourActive && tourStepNodeIds.has(node.graphId)) return node.fill;
      if (isCoverageActive) {
        if (node.is_test_file) return '#9ca3af';
        if (node.coverage_percentage != null) {
          if (Number(node.coverage_percentage) >= 80) return '#22c55e';
          if (Number(node.coverage_percentage) > 0) return '#facc15';
          return '#ef4444';
        }
        return node.has_test_coverage ? '#22c55e' : '#ef4444';
      }
      if (isHotspotActive) {
        const score = hotspotScores.get(node.graphId);
        return score != null ? hotspotColor(score) : '#374151'; // gray for files with no churn data
      }
      if (isAttackSurfaceActive) {
        const id = node.graphId;
        if (asBothIds.has(id))     return '#eab308'; // yellow  — source + sink
        if (asSourceIds.has(id))   return '#dc2626'; // red     — source
        if (asSinkIds.has(id))     return '#f97316'; // orange  — sink
        if (asPathNodeIds.has(id)) return '#facc15'; // amber   — intermediate path node
        return node.fill;
      }
      if (!isImpactActive) return node.fill;
      if (impactAnalysis?.sourceId === node.graphId) return '#ef4444';
      if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#f59e0b';
      return node.fill;
    };

    const getNodeStroke = (node) => {
      if (isTourActive && tourStepNodeIds.has(node.graphId)) return TOUR_VIOLET;
      if (isAttackSurfaceActive) {
        const id = node.graphId;
        if (asBothIds.has(id))     return '#fde047'; // yellow-300
        if (asSourceIds.has(id))   return '#fca5a5'; // red-300
        if (asSinkIds.has(id))     return '#fdba74'; // orange-300
        if (asPathNodeIds.has(id)) return '#fef08a'; // yellow-200
        return 'rgba(255, 255, 255, 0.06)';
      }
      if (isImpactActive) {
        if (impactAnalysis?.sourceId === node.graphId) return '#fecaca';
        if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#fde68a';
      }

      if (selection.primaryId === node.graphId) return '#38bdf8';
      return node.hasIssue ? '#ef4444' : 'rgba(255, 255, 255, 0.1)';
    };

    const getNodeStrokeWidth = (node) => {
      if (isTourActive && tourStepNodeIds.has(node.graphId)) return node.graphId === activeTourNodeId ? 4 : 3;
      if (isAttackSurfaceActive) {
        const id = node.graphId;
        if (asSourceIds.has(id) || asSinkIds.has(id) || asBothIds.has(id)) return 3.5;
        if (asPathNodeIds.has(id)) return 2.5;
        return 1;
      }
      if (isImpactActive) {
        if (impactAnalysis?.sourceId === node.graphId) return 3.5;
        if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return 2.5;
      }

      if (selection.primaryId === node.graphId) return 3;
      return node.hasIssue ? 3 : 1;
    };

    const focusNode = focusNodeId
      ? localNodes.find((node) => node.graphId === focusNodeId)
      : null;

    if (renderMode === 'canvas') {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      const canvasSelection = d3.select(canvas);
      let lastClickAt = 0;
      let lastClickedNodeId = null;
      let animationFrame = null;

      let dashOffset = 0;

      const draw = () => {
        context.save();
        context.clearRect(0, 0, width, height);
        context.translate(canvasTransformRef.current.x, canvasTransformRef.current.y);
        context.scale(canvasTransformRef.current.k, canvasTransformRef.current.k);

        localLinks.forEach((link) => {
          const source = typeof link.source === 'object' ? link.source : localNodes.find((node) => node.graphId === link.source);
          const target = typeof link.target === 'object' ? link.target : localNodes.find((node) => node.graphId === link.target);
          if (!source || !target) return;

          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const angle = Math.atan2(dy, dx);
          const startX = source.x + (source.radius * Math.cos(angle));
          const startY = source.y + (source.radius * Math.sin(angle));
          const endX = target.x - ((target.radius + 2) * Math.cos(angle));
          const endY = target.y - ((target.radius + 2) * Math.sin(angle));

          const lineOpacity = getEdgeOpacity(link);
          const isPathEdge = isAttackSurfaceActive && asPathEdgeIds.has(link.id);
          const isHighlightedEdge = highlightedEdgeIds.has(link.id) || isImpactActive || isPathEdge;
          const edgeColor = isAttackSurfaceActive
            ? (isPathEdge ? `rgba(250, 204, 21, ${lineOpacity})` : `rgba(148, 163, 184, ${lineOpacity})`)
            : isImpactActive ? `rgba(245, 158, 11, ${lineOpacity})` : `rgba(148, 163, 184, ${lineOpacity})`;

          context.strokeStyle = edgeColor;
          context.lineWidth = (isImpactActive || isPathEdge) ? 1.8 : isHighlightedEdge ? 1.8 : 1.2;

          if (isHighlightedEdge) {
            context.setLineDash([6, 4]);
            context.lineDashOffset = -dashOffset;
          } else {
            context.setLineDash([]);
          }

          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, endY);
          context.stroke();
          context.setLineDash([]);
        });

        if (isTourActive) {
          tourOverlayEdges.forEach((link) => {
            const dx = link.target.x - link.source.x;
            const dy = link.target.y - link.source.y;
            const angle = Math.atan2(dy, dx);
            const startRadius = getTourNodeRadius(link.source);
            const targetRadius = getTourNodeRadius(link.target);
            const startX = link.source.x + (startRadius * Math.cos(angle));
            const startY = link.source.y + (startRadius * Math.sin(angle));
            const endX = link.target.x - ((targetRadius + 2) * Math.cos(angle));
            const endY = link.target.y - ((targetRadius + 2) * Math.sin(angle));

            context.strokeStyle = TOUR_VIOLET_RGBA;
            context.lineWidth = 3;
            context.setLineDash([6, 4]);
            context.lineDashOffset = -dashOffset;
            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(endX, endY);
            context.stroke();
            context.setLineDash([]);
          });
        }

        localNodes.forEach((node) => {
          context.globalAlpha = getNodeOpacity(node.graphId);

          if (node.isCluster) {
            context.fillStyle = node.fill;
            context.globalAlpha *= 0.35;
            context.beginPath();
            context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = getNodeOpacity(node.graphId);

            context.setLineDash([4, 3]);
            context.strokeStyle = node.fill;
            context.lineWidth = 2;
            context.stroke();
            context.setLineDash([]);

            context.fillStyle = '#f8fafc';
            context.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(String(node.childCount), node.x, node.y);

            const dirLabel = node.file_path.split('/').pop() || node.file_path;
            context.fillStyle = 'rgba(248, 250, 252, 0.7)';
            context.font = '10px ui-sans-serif, system-ui, sans-serif';
            context.fillText(dirLabel, node.x, node.y + node.radius + 14);
          } else {
            const nodeFill = getNodeFill(node);
            const glowIntensity = 4 + (8 * (node.incoming_count || 0) / maxIncoming);
            context.shadowColor = nodeFill;
            context.shadowBlur = glowIntensity;
            context.fillStyle = nodeFill;
            context.beginPath();
            context.arc(node.x, node.y, getTourNodeRadius(node), 0, Math.PI * 2);
            context.fill();
            context.shadowBlur = 0;

            context.strokeStyle = getNodeStroke(node);
            context.lineWidth = getNodeStrokeWidth(node);
            context.stroke();

            if (isTourActive && node.graphId === activeTourNodeId && isTourPulseActive()) {
              const pulseAge = Math.min(1, (Date.now() - tourPulseRef.current.startedAt) / 1000);
              context.globalAlpha = 0.55 * (1 - pulseAge);
              context.strokeStyle = TOUR_VIOLET;
              context.lineWidth = 2;
              context.beginPath();
              context.arc(node.x, node.y, getTourNodeRadius(node) + 8 + (pulseAge * 10), 0, Math.PI * 2);
              context.stroke();
            }
          }
        });

        if (isTourActive) {
          localNodes.forEach((node) => {
            const badgeNumber = getTourStepBadge(node.graphId);
            if (badgeNumber == null) return;
            const nodeOpacity = getNodeOpacity(node.graphId);
            context.globalAlpha = nodeOpacity;
            const y = node.y - getTourNodeRadius(node) - 10;
            context.fillStyle = '#ffffff';
            context.beginPath();
            context.arc(node.x, y, 8, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#111827';
            context.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(String(badgeNumber), node.x, y + 0.5);
          });
        }

        context.globalAlpha = 1;
        context.restore();
      };

      const hasCanvasFlowEdges = () => {
        if (isTourActive && tourOverlayEdges.length > 0) return true;
        return localLinks.some((link) => {
          const isPathEdge = isAttackSurfaceActive && asPathEdgeIds.has(link.id);
          return highlightedEdgeIds.has(link.id) || isImpactActive || isPathEdge;
        });
      };

      // Self-cancelling loop: only runs while dash-flow edges are actually visible.
      const hasFlowEdges = hasCanvasFlowEdges();
      const animateDraw = () => {
        if (animationFrame !== null) return;
        const animate = () => {
          if (!hasCanvasFlowEdges() && !isTourPulseActive()) {
            animationFrame = null;
            draw();
            return;
          }

          dashOffset = (dashOffset + 0.65) % 20;
          draw();
          animationFrame = window.requestAnimationFrame(animate);
        };

        animationFrame = window.requestAnimationFrame(animate);
      };

      const zoomBehavior = d3.zoom()
        .scaleExtent([MIN_ZOOM, MAX_ZOOM])
        .on('zoom', (event) => {
          canvasTransformRef.current = event.transform;
          draw();
        });

      zoomBehaviorRef.current = zoomBehavior;
      canvasSelection.call(zoomBehavior);

      resetViewRef.current = () => {
        canvasSelection.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
      };

      if (focusNode) {
        const currentTransform = canvasTransformRef.current || d3.zoomIdentity;
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentTransform.k || 1));
        const nextTransform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-focusNode.x, -focusNode.y);
        const target = isTourActive ? canvasSelection.transition().duration(600) : canvasSelection;
        target.call(zoomBehavior.transform, nextTransform);
      } else if (!canvasTransformRef.current || canvasTransformRef.current === d3.zoomIdentity) {
        const xs = localNodes.map((n) => n.x);
        const ys = localNodes.map((n) => n.y);
        const minX = Math.min(...xs) - 100;
        const maxX = Math.max(...xs) + 100;
        const minY = Math.min(...ys) - 100;
        const maxY = Math.max(...ys) + 120;
        const graphWidth = Math.max(maxX - minX, 1);
        const graphHeight = Math.max(maxY - minY, 1);
        let scale = Math.min(width / graphWidth, height / graphHeight);
        scale = Math.max(0.15, Math.min(scale * 0.9, 2.5));
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const fitTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-midX, -midY);
        canvasTransformRef.current = fitTransform;
        canvasSelection.call(zoomBehavior.transform, fitTransform);
      } else {
        canvasSelection.call(zoomBehavior.transform, canvasTransformRef.current);
      }

      if (hasFlowEdges || isTourPulseActive()) {
        animateDraw();
      } else {
        draw();
      }

      const handlePointer = (event) => {
        const [x, y] = d3.pointer(event, canvas);
        const graphPoint = canvasTransformRef.current.invert([x, y]);
        const hitNode = getNodeAtPoint(localNodes, graphPoint);

        if (!hitNode) {
          onBackgroundClick?.();
          lastClickedNodeId = null;
          return;
        }

        const now = Date.now();
        if (lastClickedNodeId === hitNode.graphId && now - lastClickAt < 250) {
          onNodeDoubleClick(hitNode);
          lastClickedNodeId = null;
          lastClickAt = 0;
          return;
        }

        onNodeClick(hitNode);
        lastClickedNodeId = hitNode.graphId;
        lastClickAt = now;
      };

      canvasSelection.on('click', handlePointer);
      canvasSelection.on('contextmenu', (event) => {
        event.preventDefault();
        const [x, y] = d3.pointer(event, canvas);
        const graphPoint = canvasTransformRef.current.invert([x, y]);
        const hitNode = getNodeAtPoint(localNodes, graphPoint);
        if (hitNode) {
          onNodeContextMenu?.(hitNode, event);
        }
      });

      return () => {
        if (animationFrame) {
          window.cancelAnimationFrame(animationFrame);
        }
        canvasSelection.on('.zoom', null);
        canvasSelection.on('click', null);
        canvasSelection.on('contextmenu', null);
      };
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    const glowFilter = defs.append('filter')
      .attr('id', 'node-glow')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '5')
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const viewport = svg.append('g').attr('class', 'graph-viewport');
    const edgeLayer = viewport.append('g').attr('class', 'graph-edge-layer');
    const nodeLayer = viewport.append('g').attr('class', 'graph-node-layer');

    edgeLayer
      .selectAll('path')
      .data(localLinks, (edge) => edge.id)
      .join('path')
      .attr('class', (edge) => {
        const isDimmed = !isImpactActive && !isAttackSurfaceActive && isSelectionActive && !highlightedEdgeIds.has(edge.id);
        const isPathFlow = isAttackSurfaceActive && asPathEdgeIds.has(edge.id);
        const isFlow = (isImpactActive || highlightedEdgeIds.has(edge.id) || isPathFlow) && !isDimmed;
        return `graph-edge${isDimmed ? ' is-dimmed' : ''}${isFlow ? ' graph-edge-flow' : ''}`;
      })
      .attr('d', (edge) => {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.5; 
        if (edge.source === edge.target) {
           return `M${edge.source.x},${edge.source.y - edge.source.radius} A15,15 0 1,1 ${edge.source.x + 1},${edge.source.y - edge.source.radius}`;
        }
        return `M${edge.source.x},${edge.source.y}A${dr},${dr} 0 0,1 ${edge.target.x},${edge.target.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', (edge) => {
        if (isAttackSurfaceActive && asPathEdgeIds.has(edge.id)) return '#facc15';
        return isImpactActive ? '#f59e0b' : '#64748b';
      })
      .attr('stroke-opacity', (edge) => getEdgeOpacity(edge))
      .attr('stroke-width', (edge) => (isImpactActive ? 1.8 : highlightedEdgeIds.has(edge.id) ? 2 : 1.2));

    let svgAnimationFrame = null;
    let svgDashOffset = 0;
    const svgHasFlowEdges = () => edgeLayer.selectAll('path.graph-edge-flow').size() > 0;
    const animateSvgFlow = () => {
      if (svgAnimationFrame !== null) return;
      const animate = () => {
        if (!svgHasFlowEdges()) {
          svgAnimationFrame = null;
          return;
        }

        svgDashOffset = (svgDashOffset + 0.9) % 24;
        edgeLayer
          .selectAll('path.graph-edge-flow')
          .attr('stroke-dashoffset', -svgDashOffset);
        svgAnimationFrame = window.requestAnimationFrame(animate);
      };

      svgAnimationFrame = window.requestAnimationFrame(animate);
    };

    if (isTourActive) {
      edgeLayer
        .selectAll('path.graph-tour-edge')
        .data(tourOverlayEdges, (edge) => edge.id)
        .join('path')
        .attr('class', 'graph-tour-edge graph-edge-flow')
        .attr('d', (edge) => `M${edge.source.x},${edge.source.y}L${edge.target.x},${edge.target.y}`)
        .attr('fill', 'none')
        .attr('stroke', TOUR_VIOLET)
        .attr('stroke-opacity', 0.95)
        .attr('stroke-width', 3);
    }

    if (svgHasFlowEdges()) {
      animateSvgFlow();
    }

    const nodeGroups = nodeLayer
      .selectAll('g.graph-node-group')
      .data(localNodes, (node) => node.graphId)
      .join('g')
      .attr('class', (node) => `graph-node-group${getNodeOpacity(node.graphId) < 0.2 ? ' is-dimmed' : ''}`)
      .attr('transform', (node) => `translate(${node.x}, ${node.y})`)
      .attr('opacity', (node) => getNodeOpacity(node.graphId))
      .style('cursor', 'pointer');

    nodeGroups.append('circle')
      .attr('r', (node) => getTourNodeRadius(node))
      .attr('fill', (node) => {
        if (node.isCluster) {
          return getNodeFill(node);
        }
        return getNodeFill(node);
      })
      .attr('fill-opacity', (node) => (node.isCluster ? 0.25 : 1))
      .attr('stroke', (node) => {
        if (node.isCluster) return node.fill;
        return getNodeStroke(node);
      })
      .attr('stroke-width', (node) => (node.isCluster ? 2 : getNodeStrokeWidth(node)))
      .attr('stroke-dasharray', (node) => (node.isCluster ? '5,3' : 'none'))
      .attr('filter', (node) => (node.isCluster ? 'none' : 'url(#node-glow)'));

    if (isTourActive && activeTourNodeId) {
      nodeGroups
        .filter((node) => node.graphId === activeTourNodeId)
        .append('circle')
        .attr('class', 'graph-tour-pulse')
        .attr('r', (node) => getTourNodeRadius(node) + 8)
        .attr('fill', 'none')
        .attr('stroke', TOUR_VIOLET)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.55)
        .transition()
        .duration(1000)
        .attr('r', (node) => getTourNodeRadius(node) + 18)
        .attr('stroke-opacity', 0);
    }

    if (isTourActive) {
      const badgeGroups = nodeGroups
        .filter((node) => getTourStepBadge(node.graphId) != null)
        .append('g')
        .attr('class', 'graph-tour-badge')
        .attr('transform', (node) => `translate(0, ${-getTourNodeRadius(node) - 10})`)
        .attr('pointer-events', 'none');

      badgeGroups.append('circle')
        .attr('r', 8)
        .attr('fill', '#ffffff');

      badgeGroups.append('text')
        .text((node) => getTourStepBadge(node.graphId))
        .attr('x', 0)
        .attr('y', 0.5)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', '#111827')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif');
    }

    nodeGroups.filter((node) => node.isCluster)
      .append('text')
      .text((node) => node.childCount)
      .attr('x', 0)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#f8fafc')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none');

    nodeGroups.append('text')
      .text((node) => {
        if (node.isCluster) {
          const dirName = node.file_path.split('/').pop() || node.file_path;
          return `${dirName}/`;
        }
        const parts = node.file_path.split('/');
        return parts.pop();
      })
      .attr('x', 0)
      .attr('y', (node) => node.radius + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', (node) => {
        if (impactAnalysis?.sourceId === node.graphId) return '#fef2f2';
        if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#fffbeb';
        return selection.primaryId === node.graphId ? '#f8fafc' : '#a8b3c5';
      })
      .attr('font-size', (node) => ((selection.primaryId === node.graphId || impactAnalysis?.sourceId === node.graphId) ? '13px' : '11px'))
      .attr('font-weight', (node) => ((selection.primaryId === node.graphId || impactAnalysis?.sourceId === node.graphId) ? '600' : '400'))
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .attr('opacity', (node) => getNodeOpacity(node.graphId));

    nodeGroups.append('title').text((node) => node.file_path);

    const nodeSelection = nodeGroups;

    nodeSelection.on('click', (_event, node) => {
      onNodeClick(node);
    });

    nodeSelection.on('dblclick', (_event, node) => {
      onNodeDoubleClick(node);
    });

    nodeSelection.on('contextmenu', (event, node) => {
      event.preventDefault();
      onNodeContextMenu?.(node, event);
    });

    svg.on('click', (event) => {
      if (event.target === svg.node()) {
        onBackgroundClick?.();
      }
    });

    const zoomBehavior = d3.zoom()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .on('zoom', (event) => {
        viewport.attr('transform', event.transform);
      });

    zoomBehaviorRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    resetViewRef.current = () => {
      svg.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
    };

    if (focusNode) {
      const currentTransform = d3.zoomTransform(svg.node()) || d3.zoomIdentity;
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentTransform.k || 1));
      const nextTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-focusNode.x, -focusNode.y);
      const target = isTourActive ? svg.transition().duration(600) : svg;
      target.call(zoomBehavior.transform, nextTransform);
    } else {
      const xs = localNodes.map((n) => n.x);
      const ys = localNodes.map((n) => n.y);
      const minX = Math.min(...xs) - 100;
      const maxX = Math.max(...xs) + 100;
      const minY = Math.min(...ys) - 100;
      const maxY = Math.max(...ys) + 120;
      const graphWidth = Math.max(maxX - minX, 1);
      const graphHeight = Math.max(maxY - minY, 1);
      
      let scale = Math.min(width / graphWidth, height / graphHeight);
      scale = Math.max(0.15, Math.min(scale * 0.9, 2.5));
      
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      
      const fitTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-midX, -midY);
      svg.call(zoomBehavior.transform, fitTransform);
    }

    return () => {
      if (svgAnimationFrame) {
        window.cancelAnimationFrame(svgAnimationFrame);
      }
      svg.on('.zoom', null);
      svg.on('click', null);
    };
  }, [
    layoutVersion,
    canvasRef,
    svgRef,
    renderMode,
    selection,
    impactAnalysis,
    attackSurface,
    tour,
    hotspotMode,
    coverageMode,
    focusNodeId,
    onBackgroundClick,
    onNodeClick,
    onNodeContextMenu,
    onNodeDoubleClick,
  ]);

  return {
    resetView: () => resetViewRef.current(),
  };
}
