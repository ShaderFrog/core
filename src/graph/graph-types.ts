import { DataNode } from './data-nodes';
import { Edge } from './edge';
import { SourceNode } from './code-nodes';

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

export const MAGIC_OUTPUT_STMTS = 'mainStmts';
