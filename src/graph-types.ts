import { DataNode } from './nodes/data-nodes';
import { Edge } from './nodes/edge';
import { SourceNode } from './nodes/code-nodes';

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

export const MAGIC_OUTPUT_STMTS = 'mainStmts';
