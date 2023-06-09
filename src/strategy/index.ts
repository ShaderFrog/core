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

export * from './hardCode';
export * from './uniform';
export * from './assignemntTo';
export * from './declarationOf';
export * from './texture2D';
export * from './namedAttribute';
export * from './variable';

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

export type ApplyStrategy<T> = (
  node: SourceNode,
  ast: AstNode | Program,
  strategy: T
) => ComputedInput[];

type Strategies = Record<
  StrategyType,
  // I don't know how else to make ApplyStrategy take a generic as well as
  // make the object below well typed, as well as make applyStrategy() have
  // the right return type.
  (...args: any[]) => ReturnType<ApplyStrategy<BaseStrategy>>
>;

const strategyRunners: Strategies = {
  [StrategyType.HARD_CODE]: applyHardCodeStrategy,
  [StrategyType.UNIFORM]: applyUniformStrategy,
  [StrategyType.ASSIGNMENT_TO]: applyAssignmentToStrategy,
  [StrategyType.DECLARATION_OF]: constApplyDeclarationOfStrategy,
  [StrategyType.TEXTURE_2D]: applyTexture2DStrategy,
  [StrategyType.NAMED_ATTRIBUTE]: applyNamedAttributeStrategy,
  [StrategyType.VARIABLE]: applyVariableStrategy,
};

export const applyStrategy = (
  strategy: Strategy,
  node: SourceNode,
  ast: AstNode | Program
) => strategyRunners[strategy.type](node, ast, strategy);
