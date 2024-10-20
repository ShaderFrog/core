import { DataNode } from './data-nodes';
import { Edge } from './edge';
import { SourceNode } from './code-nodes';
import { indexById } from './graph';

/**
 * Core graph types.
 *
 * Originally abstracted out of graph.ts to avoid a circular
 * dependency between graph.ts and parsers.ts. Both files need these types at
 * module initialization time, and without this third file, the types will be
 * undefined in either graph/parsers.ts at init time. If the types were only
 * used at runtime it would be fine, because the circular depenency is resolved
 * by then.
 */

export type ShaderStage = 'fragment' | 'vertex';

/**
 * The type applied to the edge representing a link between node stages
 */
export enum EdgeLink {
  NEXT_STAGE = 'next_stage',
}

/**
 * The handle types for links. These become <Handle /> ids
 */
export enum LinkHandle {
  NEXT_STAGE = 'next_stage',
  PREVIOUS_STAGE = 'previous_stage',
}

export enum NodeType {
  OUTPUT = 'output',
  BINARY = 'binary',
  SOURCE = 'source',
}

export type GraphNode = SourceNode | DataNode;

export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}

export type EdgesByNode = {
  [nodeId: string]: {
    // All the edges that flow out from this node
    from: Edge[];
    // All the edges that flow to this node
    to: {
      edges: Edge[];
      // And each edge flowing into this node by the input it connects in to
      edgesByInput: { [inputId: string]: Edge };
    };
  };
};
export type Grindex = {
  nodes: { [nodeId: string]: GraphNode };
  edges: { [edgeId: string]: Edge };
  edgesByNode: EdgesByNode;
};

let lastGraph: Graph | undefined;
let lastGrindex: Grindex | undefined;
export const computeGrindex = (graph: Graph): Grindex => {
  // Poor programmer's memoization
  if (graph === lastGraph && lastGrindex) {
    return lastGrindex;
  }
  lastGraph = graph;
  lastGrindex = {
    nodes: indexById(graph.nodes),
    edges: indexById(graph.edges),
    edgesByNode: graph.edges.reduce<EdgesByNode>((acc, edge) => {
      const { to, from } = edge;
      return {
        ...acc,
        [to]: {
          to: {
            edges: [...(acc[to]?.to?.edges || []), edge],
            edgesByInput: {
              ...acc[to]?.to?.edgesByInput,
              [edge.input]: edge,
            },
          },
          from: acc[to]?.from || [],
        },
        [from]: {
          to: {
            edges: acc[from]?.to?.edges || [],
            edgesByInput: {
              ...acc[from]?.to?.edgesByInput,
              [edge.input]: edge,
            },
          },
          from: [...(acc[from]?.from || []), edge],
        },
      };
    }, {}),
  };
  return lastGrindex;
};

export const MAGIC_OUTPUT_STMTS = 'mainStmts';
