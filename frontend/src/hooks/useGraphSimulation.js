import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const PRETICK_FULL = 300;
const PRETICK_CLUSTERED = 150;

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

function drawArrowhead(context, fromX, fromY, toX, toY, size, color) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(toX, toY);
  context.lineTo(
    toX - (size * Math.cos(angle - Math.PI / 6)),
    toY - (size * Math.sin(angle - Math.PI / 6))
  );
  context.lineTo(
    toX - (size * Math.cos(angle + Math.PI / 6)),
    toY - (size * Math.sin(angle + Math.PI / 6))
  );
  context.closePath();
  context.fill();
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
  focusNodeId,
  onNodeClick,
  onNodeContextMenu,
  onNodeDoubleClick,
  onBackgroundClick,
  onNodeHover,
}) {
  const zoomBehaviorRef = useRef(null);
  const canvasTransformRef = useRef(d3.zoomIdentity);
  const resetViewRef = useRef(() => {});

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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
    let width = dimensions.width;
    let height = dimensions.height;

    // Fallback: if the ResizeObserver hasn't fired yet (e.g. the container
    // wasn't in the DOM when the observer was first set up), read directly
    // from the container element now that React has committed it.
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

    // Tightly pack clusters
    const simulation = d3.forceSimulation(localNodes)
      .force('link', d3.forceLink(localLinks).id((node) => node.graphId).distance((link) => {
        const targetRadius = typeof link.target === 'object' ? link.target.radius : 14;
        return Math.max(40, 50 + targetRadius);
      }))
      // Super weak long-distance repel, preventing them from flying apart
      .force('charge', d3.forceManyBody().strength(-400).distanceMax(250))
      // Strong centripetal gravity to pull disconnected components together beautifully
      .force('x', d3.forceX(width / 2).strength(0.18))
      .force('y', d3.forceY(height / 2).strength(0.18))
      // Push nodes apart locally so they don't overlap labels
      .force('collide', d3.forceCollide().radius((node) => node.radius + 35).iterations(3))
      .stop();

    for (let tick = 0; tick < pretickCount; tick += 1) {
      simulation.tick();
    }

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

    const getNodeOpacity = (nodeId) => {
      if (isImpactActive) {
        return impactedNodeIds.has(nodeId) ? 1 : 0.12;
      }
      return !isSelectionActive || highlightedNodeIds.has(nodeId) ? 1 : 0.15;
    };

    const getEdgeOpacity = (edge) => {
      if (isImpactActive) {
        const sourceId = typeof edge.source === 'object' ? edge.source.graphId : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.graphId : edge.target;
        return impactedNodeIds.has(sourceId) && impactedNodeIds.has(targetId) ? 0.75 : 0.08;
      }
      return !isSelectionActive || highlightedEdgeIds.has(edge.id) ? 0.9 : 0.15;
    };

    const getNodeFill = (node) => {
      if (!isImpactActive) return node.fill;
      if (impactAnalysis?.sourceId === node.graphId) return '#ef4444';
      if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#f59e0b';
      return node.fill;
    };

    const getNodeStroke = (node) => {
      if (isImpactActive) {
        if (impactAnalysis?.sourceId === node.graphId) return '#fecaca';
        if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#fde68a';
      }

      if (selection.primaryId === node.graphId) return '#38bdf8';
      return node.hasIssue ? '#ef4444' : 'rgba(255, 255, 255, 0.1)';
    };

    const getNodeStrokeWidth = (node) => {
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
      if (!canvas) {
        simulation.stop();
        return undefined;
      }

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      const canvasSelection = d3.select(canvas);
      let lastClickAt = 0;
      let lastClickedNodeId = null;

      let dashOffset = 0;
      let animFrame = null;

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
          const endX = target.x - ((target.radius + 8) * Math.cos(angle));
          const endY = target.y - ((target.radius + 8) * Math.sin(angle));

          const lineOpacity = getEdgeOpacity(link);
          const isHighlightedEdge = highlightedEdgeIds.has(link.id) || isImpactActive;
          const edgeColor = isImpactActive ? `rgba(245, 158, 11, ${lineOpacity})` : `rgba(148, 163, 184, ${lineOpacity})`;

          context.strokeStyle = edgeColor;
          context.lineWidth = isImpactActive ? 1.8 : isHighlightedEdge ? 1.8 : 1.2;

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

          drawArrowhead(context, startX, startY, endX, endY, 7, edgeColor);
        });

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
            const glowIntensity = 8 + (12 * (node.incoming_count || 0) / maxIncoming);
            context.shadowColor = nodeFill;
            context.shadowBlur = glowIntensity;
            context.fillStyle = nodeFill;
            context.beginPath();
            context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            context.fill();
            context.shadowBlur = 0;

            context.strokeStyle = getNodeStroke(node);
            context.lineWidth = getNodeStrokeWidth(node);
            context.stroke();
          }
        });

        context.globalAlpha = 1;
        context.restore();
      };

      const animateDraw = () => {
        dashOffset = (dashOffset + 0.4) % 20;
        draw();
        animFrame = requestAnimationFrame(animateDraw);
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
        const nextTransform = d3.zoomIdentity
          .translate((width / 2) - focusNode.x, (height / 2) - focusNode.y)
          .scale(1);
        canvasSelection.call(zoomBehavior.transform, nextTransform);
      } else {
        canvasSelection.call(zoomBehavior.transform, d3.zoomIdentity);
      }

      if (isSelectionActive || isImpactActive) {
        animateDraw();
      } else {
        draw();
      }

      // Hover tracking
      let lastHoveredId = null;
      canvasSelection.on('mousemove', (event) => {
        const [x, y] = d3.pointer(event, canvas);
        const graphPoint = canvasTransformRef.current.invert([x, y]);
        const hitNode = getNodeAtPoint(localNodes, graphPoint);
        const hitId = hitNode?.graphId || null;
        if (hitId !== lastHoveredId) {
          lastHoveredId = hitId;
          onNodeHover?.(hitNode && !hitNode.isCluster ? hitNode : null, hitNode ? event : null);
        }
      });
      canvasSelection.on('mouseleave', () => {
        lastHoveredId = null;
        onNodeHover?.(null, null);
      });

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
        simulation.stop();
        if (animFrame) cancelAnimationFrame(animFrame);
        localNodes.length = 0;
        localLinks.length = 0;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvasSelection.on('.zoom', null);
        canvasSelection.on('click', null);
        canvasSelection.on('contextmenu', null);
        canvasSelection.on('mousemove', null);
        canvasSelection.on('mouseleave', null);
      };
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'dependency-arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 12)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#94a3b8');

    // Glow filter — blurs the node's own color to create a bloom effect
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
        const isDimmed = !isImpactActive && isSelectionActive && !highlightedEdgeIds.has(edge.id);
        const isFlow = (isImpactActive || highlightedEdgeIds.has(edge.id)) && !isDimmed;
        return `graph-edge${isDimmed ? ' is-dimmed' : ''}${isFlow ? ' graph-edge-flow' : ''}`;
      })
      .attr('d', (edge) => {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.5; // Smooth arc
        // If it's a self-link, draw a loop instead
        if (edge.source === edge.target) {
           return `M${edge.source.x},${edge.source.y - edge.source.radius} A15,15 0 1,1 ${edge.source.x + 1},${edge.source.y - edge.source.radius}`;
        }
        return `M${edge.source.x},${edge.source.y}A${dr},${dr} 0 0,1 ${edge.target.x},${edge.target.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', () => (isImpactActive ? '#f59e0b' : '#64748b'))
      .attr('stroke-opacity', (edge) => getEdgeOpacity(edge))
      .attr('stroke-width', (edge) => (isImpactActive ? 1.8 : highlightedEdgeIds.has(edge.id) ? 2 : 1.2))
      .attr('marker-end', 'url(#dependency-arrowhead)');

    // Create node groups (circle + label)
    const nodeGroups = nodeLayer
      .selectAll('g.graph-node-group')
      .data(localNodes, (node) => node.graphId)
      .join('g')
      .attr('class', (node) => `graph-node-group${getNodeOpacity(node.graphId) < 0.2 ? ' is-dimmed' : ''}`)
      .attr('transform', (node) => `translate(${node.x}, ${node.y})`)
      .attr('opacity', (node) => getNodeOpacity(node.graphId))
      .style('cursor', 'pointer');

    // Circle — different rendering for clusters vs regular nodes
    nodeGroups.append('circle')
      .attr('r', (node) => node.radius)
      .attr('fill', (node) => {
        if (node.isCluster) {
          const baseFill = getNodeFill(node);
          // Semi-transparent fill for clusters
          return baseFill;
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

    // Child count badge for cluster nodes
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

    // File name label
    nodeGroups.append('text')
      .text((node) => {
        if (node.isCluster) {
          const dirName = node.file_path.split('/').pop() || node.file_path;
          return `${dirName}/`;
        }
        const parts = node.file_path.split('/');
        return parts.pop(); // basename only
      })
      .attr('x', 0)
      .attr('y', (node) => node.radius + 16) // Centered exactly below node
      .attr('text-anchor', 'middle')
      .attr('fill', (node) => {
        if (impactAnalysis?.sourceId === node.graphId) return '#fef2f2';
        if (directImpactIds.has(node.graphId) || transitiveImpactIds.has(node.graphId)) return '#fffbeb';
        return selection.primaryId === node.graphId ? '#f8fafc' : '#94a3b8';
      })
      .attr('font-size', (node) => ((selection.primaryId === node.graphId || impactAnalysis?.sourceId === node.graphId) ? '13px' : '11px'))
      .attr('font-weight', (node) => ((selection.primaryId === node.graphId || impactAnalysis?.sourceId === node.graphId) ? '600' : '400'))
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .attr('opacity', (node) => getNodeOpacity(node.graphId));

    // Tooltip with full path
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

    nodeSelection.on('mouseenter', (event, node) => {
      if (!node.isCluster) onNodeHover?.(node, event);
    });
    nodeSelection.on('mouseleave', () => {
      onNodeHover?.(null, null);
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
      const nextTransform = d3.zoomIdentity
        .translate((width / 2) - focusNode.x, (height / 2) - focusNode.y)
        .scale(1);
      svg.call(zoomBehavior.transform, nextTransform);
    } else {
      // Auto-fit: calculate bounding box and zoom to fit all nodes
      const xs = localNodes.map((n) => n.x);
      const ys = localNodes.map((n) => n.y);
      const minX = Math.min(...xs) - 100;
      const maxX = Math.max(...xs) + 100;
      const minY = Math.min(...ys) - 100;
      const maxY = Math.max(...ys) + 120; // extra padding for bottom text labels
      const graphWidth = Math.max(maxX - minX, 1);
      const graphHeight = Math.max(maxY - minY, 1);
      
      // Calculate scale to fit. Limit max scale to 2.5 (super clear), min scale to 0.15
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
      simulation.stop();
      localNodes.length = 0;
      localLinks.length = 0;
      svg.on('.zoom', null);
      svg.on('click', null);
      onNodeHover?.(null, null);
    };
  }, [
    canvasRef,
    containerRef,
    dimensions,
    edges,
    focusNodeId,
    nodes,
    impactAnalysis,
    onBackgroundClick,
    onNodeClick,
    onNodeContextMenu,
    onNodeDoubleClick,
    onNodeHover,
    renderMode,
    selection,
    svgRef,
  ]);

  return {
    resetView: () => resetViewRef.current(),
  };
}
