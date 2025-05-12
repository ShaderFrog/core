/**
 * Base node stuff, used across all nodes
 */
import { GraphDataType } from './data-nodes';

export type InputCategory = 'data' | 'code';
export type InputType = 'uniform' | 'property' | 'filler';

export interface NodeInput {
  displayName: string;
  id: string;
  type: InputType;
  dataType?: GraphDataType;
  accepts: InputCategory[];
  baked?: boolean;
  bakeable: boolean;
  property?: string;
}
export const nodeInput = (
  displayName: string,
  id: string,
  type: InputType,
  dataType: GraphDataType | undefined,
  accepts: InputCategory[],
  bakeable: boolean,
  property?: string
): NodeInput => ({
  displayName,
  id,
  type,
  dataType,
  accepts,
  bakeable,
  property,
});

export interface NodeOutput {
  name: string;
  id: string;
  // Optional because not all outputs have known data types - like expressions
  // and multiply nodes. Maybe in the future I can infer this - although there
  // can be ambiguous/multi-type GLSL expressions
  dataType?: GraphDataType;
  category: InputCategory;
}

export type NodePosition = { x: number; y: number };

export type NodeInputSectionVisibility = 'visible' | 'hidden';
export type NodeInputSection = 'Properties' | 'Uniforms' | 'Code';

export interface BaseNode {
  id: string;
  parentId?: string;
  name: string;
  type: string;
  inputs: NodeInput[];
  outputs: NodeOutput[];
  position: NodePosition;
  display?: {
    visibilities: Partial<Record<NodeInputSection, NodeInputSectionVisibility>>;
  };
}
