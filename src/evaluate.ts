import { Engine } from './engine';
import { Edge } from './nodes/edge';
import { SourceNode } from './nodes/code-nodes';
import { coreParsers } from './parsers';
import { Graph, GraphNode } from './graph-types';
import { DataNode } from './nodes/data-nodes';

export type Evaluator = (node: GraphNode) => any;
export type Evaluate = (
  node: SourceNode,
  inputEdges: Edge[],
  inputNodes: GraphNode[],
  evaluate: Evaluator
) => any;

export const toGlsl = (node: DataNode): string => {
  const { type, value } = node;
  if (type === 'vector2') {
    return `vec2(${value[0]}, ${value[1]})`;
  }
  if (type === 'vector3' || type === 'rgb') {
    return `vec3(${value[0]}, ${value[1]}, ${value[2]})`;
  }
  if (type === 'vector4' || type === 'rgba') {
    return `vec4(${value[0]}, ${value[1]}, ${value[2]}, ${value[3]})`;
  }
  throw new Error(`Unknown GLSL inline type: "${node.type}"`);
};

export const evaluateNode = (
  engine: Engine,
  graph: Graph,
  node: GraphNode
): any => {
  // TODO: Data nodes themselves should have evaluators
  if ('value' in node) {
    return engine.evaluateNode(node);
  }

  const { evaluate } = coreParsers[node.type];
  if (!evaluate) {
    throw new Error(
      `No evaluator for node ${node.name} (type: ${node.type}, id: ${node.id})`
    );
  }
  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);
  const inputNodes = inputEdges.map(
    (edge) => graph.nodes.find((node) => node.id === edge.from) as GraphNode
  );

  return evaluate(
    node as SourceNode,
    inputEdges,
    inputNodes,
    evaluateNode.bind(null, engine, graph)
  );
};
