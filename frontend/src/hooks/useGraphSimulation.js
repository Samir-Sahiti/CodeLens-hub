import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const PRETICK_COUNT = 300;

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
  focusNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onBackgroundClick,
}) {
  const zoomBehaviorRef = useRef(null);
  const canvasTransformRef = useRef(d3.zoomIdentity);
  const resetViewRef = useRef(() => {});

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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
  }, [canvasRef, containerRef, renderMode, svgRef]);

  useEffect(() => {
    const width = dimensions.width;
    const height = dimensions.height;

    if (!width || !height || nodes.length === 0) {
      return undefined;
    }

    const localNodes = nodes.map((node) => ({
      ...node,
      x: width / 2,
      y: height / 2,
    }));
      const localLinks = edges.map((edge) => ({ ...edge }));

    const simulation = d3.forceSimulation(localNodes)
      .force('link', d3.forceLink(localLinks).id((node) => node.graphId).distance((link) => {
        const targetRadius = typeof link.target === 'object' ? link.target.radius : 14;
        return Math.max(36, 80 + targetRadius);
      }))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((node) => node.radius + 8))
      .stop();

    for (let tick = 0; tick < PRETICK_COUNT; tick += 1) {
      simulation.tick();
    }

    const highlightedNodeIds = selection.highlightedNodeIds;
    const highlightedEdgeIds = selection.highlightedEdgeIds;
    const isSelectionActive = selection.isActive;

    const edgeOpacity = (edgeId) => (!isSelectionActive || highlightedEdgeIds.has(edgeId) ? 0.9 : 0.15);
    const nodeOpacity = (nodeId) => (!isSelectionActive || highlightedNodeIds.has(nodeId) ? 1 : 0.15);

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

          context.strokeStyle = `rgba(148, 163, 184, ${edgeOpacity(link.id)})`;
          context.lineWidth = highlightedEdgeIds.has(link.id) ? 1.8 : 1.2;
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, endY);
          context.stroke();

          drawArrowhead(context, startX, startY, endX, endY, 7, `rgba(148, 163, 184, ${edgeOpacity(link.id)})`);
        });

        localNodes.forEach((node) => {
          context.globalAlpha = nodeOpacity(node.graphId);
          context.fillStyle = node.fill;
          context.beginPath();
          context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
          context.fill();

          context.strokeStyle = node.hasIssue ? '#ef4444' : '#0f172a';
          context.lineWidth = node.hasIssue ? 2.5 : 1.25;
          context.stroke();

          if (selection.primaryId === node.graphId) {
            context.strokeStyle = '#f8fafc';
            context.lineWidth = 2.5;
            context.stroke();
          }
        });

        context.globalAlpha = 1;
        context.restore();
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

      draw();

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

      return () => {
        simulation.stop();
        canvasSelection.on('.zoom', null);
        canvasSelection.on('click', null);
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

    const viewport = svg.append('g').attr('class', 'graph-viewport');
    const edgeLayer = viewport.append('g').attr('class', 'graph-edge-layer');
    const nodeLayer = viewport.append('g').attr('class', 'graph-node-layer');

    edgeLayer
      .selectAll('line')
      .data(localLinks, (edge) => edge.id)
      .join('line')
      .attr('class', (edge) => `graph-edge${isSelectionActive && !highlightedEdgeIds.has(edge.id) ? ' is-dimmed' : ''}`)
      .attr('x1', (edge) => edge.source.x)
      .attr('y1', (edge) => edge.source.y)
      .attr('x2', (edge) => edge.target.x)
      .attr('y2', (edge) => edge.target.y)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', (edge) => (highlightedEdgeIds.has(edge.id) ? 1.8 : 1.2))
      .attr('marker-end', 'url(#dependency-arrowhead)');

    const nodeSelection = nodeLayer
      .selectAll('circle')
      .data(localNodes, (node) => node.graphId)
      .join('circle')
      .attr('class', (node) => `graph-node${isSelectionActive && !highlightedNodeIds.has(node.graphId) ? ' is-dimmed' : ''}`)
      .attr('cx', (node) => node.x)
      .attr('cy', (node) => node.y)
      .attr('r', (node) => node.radius)
      .attr('fill', (node) => node.fill)
      .attr('stroke', (node) => {
        if (selection.primaryId === node.graphId) return '#f8fafc';
        return node.hasIssue ? '#ef4444' : '#0f172a';
      })
      .attr('stroke-width', (node) => {
        if (selection.primaryId === node.graphId) return 2.5;
        return node.hasIssue ? 2.5 : 1.25;
      })
      .style('cursor', 'pointer');

    nodeSelection.append('title').text((node) => node.file_path);

    nodeSelection.on('click', (_event, node) => {
      onNodeClick(node);
    });

    nodeSelection.on('dblclick', (_event, node) => {
      onNodeDoubleClick(node);
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
      svg.call(zoomBehavior.transform, d3.zoomIdentity);
    }

    return () => {
      simulation.stop();
      svg.on('.zoom', null);
      svg.on('click', null);
    };
  }, [
    canvasRef,
    containerRef,
    dimensions,
    edges,
    focusNodeId,
    nodes,
    onBackgroundClick,
    onNodeClick,
    onNodeDoubleClick,
    renderMode,
    selection,
    svgRef,
  ]);

  return {
    resetView: () => resetViewRef.current(),
  };
}
