import { AstNode, Program } from '@shaderfrog/glsl-parser/ast';
import { ComputedInput } from '../graph';
import { SourceNode } from '../nodes/code-nodes';
import { HardCodeStrategy, applyHardCodeStrategy } from './hardCode';
import { UniformStrategy, applyUniformStrategy } from './uniform';
import {
  AssignemntToStrategy,
  applyAssignmentToStrategy,
} from './assignemntTo';
import {
  DeclarationOfStrategy,
  constApplyDeclarationOf as constApplyDeclarationOfStrategy,
} from './declarationOf';
import { Texture2DStrategy, applyTexture2DStrategy } from './texture2D';
import {
  NamedAttributeStrategy,
  applyNamedAttributeStrategy,
} from './namedAttribute';
import { VariableStrategy, applyVariableStrategy } from './variable';

export enum StrategyType {
  VARIABLE = 'Variable Names',
  ASSIGNMENT_TO = 'Assignment To',
  DECLARATION_OF = 'Variable Declaration',
  TEXTURE_2D = 'Texture2D',
  NAMED_ATTRIBUTE = 'Named Attribute',
  UNIFORM = 'Uniform',
  HARD_CODE = 'Hard Code Inputs',
}

export interface BaseStrategy {
  type: StrategyType;
  config: Object;
}

export type Strategy =
  | UniformStrategy
  | AssignemntToStrategy
  | Texture2DStrategy
  | NamedAttributeStrategy
  | VariableStrategy
  | HardCodeStrategy
  | DeclarationOfStrategy;

export type StrategyImpl = (
  node: SourceNode,
  ast: AstNode | Program,
  strategy: Strategy
) => ComputedInput[];

type Strategies = Record<StrategyType, StrategyImpl>;

export const applyStrategy = (
  strategy: Strategy,
  node: SourceNode,
  ast: AstNode | Program
) => strategyRunners[strategy.type](node, ast, strategy);

export const strategyRunners: Strategies = {
  [StrategyType.HARD_CODE]: applyHardCodeStrategy,
  [StrategyType.UNIFORM]: applyUniformStrategy,
  [StrategyType.ASSIGNMENT_TO]: applyAssignmentToStrategy,
  [StrategyType.DECLARATION_OF]: constApplyDeclarationOfStrategy,
  [StrategyType.TEXTURE_2D]: applyTexture2DStrategy,
  [StrategyType.NAMED_ATTRIBUTE]: applyNamedAttributeStrategy,
  [StrategyType.VARIABLE]: applyVariableStrategy,
};
