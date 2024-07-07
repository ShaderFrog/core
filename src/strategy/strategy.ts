import { AstNode, Program } from '@shaderfrog/glsl-parser/ast';
import { SourceNode } from '../graph/code-nodes';
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
import { InjectStrategy, applyInjectStrategy } from './inject';
import { ComputedInput } from '../graph/parsers';

export enum StrategyType {
  VARIABLE = 'Variable Names',
  ASSIGNMENT_TO = 'Assignment To',
  DECLARATION_OF = 'Variable Declaration',
  TEXTURE_2D = 'Texture2D',
  NAMED_ATTRIBUTE = 'Named Attribute',
  UNIFORM = 'Uniform',
  INJECT = 'Inject',
  HARD_CODE_INPUTS = 'Hard Code Inputs',
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
  | InjectStrategy
  | DeclarationOfStrategy;

export type ApplyStrategy<T> = (
  strategy: T,
  ast: AstNode | Program,
  node: SourceNode,
  sibling?: SourceNode,
) => ComputedInput[];

type Strategies = Record<
  StrategyType,
  // I don't know how else to make ApplyStrategy take a generic as well as
  // make the object below well typed, as well as make applyStrategy() have
  // the right return type.
  (...args: any[]) => ReturnType<ApplyStrategy<BaseStrategy>>
>;

const strategyRunners: Strategies = {
  [StrategyType.INJECT]: applyInjectStrategy,
  [StrategyType.HARD_CODE_INPUTS]: applyHardCodeStrategy,
  [StrategyType.UNIFORM]: applyUniformStrategy,
  [StrategyType.ASSIGNMENT_TO]: applyAssignmentToStrategy,
  [StrategyType.DECLARATION_OF]: constApplyDeclarationOfStrategy,
  [StrategyType.TEXTURE_2D]: applyTexture2DStrategy,
  [StrategyType.NAMED_ATTRIBUTE]: applyNamedAttributeStrategy,
  [StrategyType.VARIABLE]: applyVariableStrategy,
};

export const applyStrategy = (
  strategy: Strategy,
  ast: AstNode | Program,
  node: SourceNode,
  sibling?: SourceNode,
) => strategyRunners[strategy.type](strategy, ast, node, sibling);
