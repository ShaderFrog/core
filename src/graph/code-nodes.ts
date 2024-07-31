import { ShaderStage } from './graph-types';
import { Strategy } from '../strategy';
import { GraphDataType, UniformDataType } from './data-nodes';
import { BaseNode, NodeInput } from './base-node';

export const mapInputName = (
  node: CodeNode,
  { id, displayName }: NodeInput,
): string => node.config?.inputMapping?.[id] || displayName;

export type InputMapping = { [original: string]: string };
export type NodeConfig = {
  version: 2 | 3;
  mangle?: boolean;
  preprocess: boolean;
  inputMapping?: InputMapping;
  strategies: Strategy[];
  uniforms: UniformDataType[];
  properties?: NodeProperty[];
  hardCodedProperties?: Record<string, any>;
};

export interface NodeProperty {
  // Display name, like "albedo"
  displayName: string;
  // Type in the engine, like "texture"
  type: GraphDataType;
  // Property name to apply to the material, like "map"
  property: string;
  // The name of the filler this property introduces, aka the GLSL source code
  // to be replaced, if this property is present.
  fillerName?: string;
  defaultValue?: any;
}

export const property = (
  displayName: string,
  property: string,
  type: GraphDataType,
  fillerName?: string,
  defaultValue?: any,
): NodeProperty => ({
  displayName,
  type,
  property,
  fillerName,
  defaultValue,
});

export enum SourceType {
  SHADER_PROGRAM = 'Shader Program',
  EXPRESSION = 'Expression',
  FN_BODY_FRAGMENT = 'Function Body Fragment',
}

export interface CodeNode extends BaseNode {
  config: NodeConfig;
  engine: boolean;
  source: string;
  sourceType?: SourceType;
  stage?: ShaderStage;
  biStage?: boolean;
  originalEngine?: string;
}

export interface BinaryNode extends CodeNode {
  operator: string;
}

export type SourceNode = BinaryNode | CodeNode;
