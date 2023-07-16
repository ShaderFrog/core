import { findDeclarationOf } from '../ast/manipulate';
import { InputCategory, nodeInput } from '../nodes/core-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { AstNode } from '@shaderfrog/glsl-parser/ast';

export const declarationOfStrategy = (
  declarationOf: string
): DeclarationOfStrategy => ({
  type: StrategyType.DECLARATION_OF,
  config: { declarationOf },
});
export interface DeclarationOfStrategy extends BaseStrategy {
  type: StrategyType.DECLARATION_OF;
  config: {
    declarationOf: string;
  };
}

export const constApplyDeclarationOf: ApplyStrategy<DeclarationOfStrategy> = (
  node,
  ast,
  strategy
) => {
  const declaration = findDeclarationOf(ast, strategy.config.declarationOf);
  const name = strategy.config.declarationOf;
  return declaration
    ? [
        [
          nodeInput(
            name,
            `filler_${name}`,
            'filler',
            undefined, // Data type for what plugs into this filler
            new Set<InputCategory>(['code', 'data']),
            false
          ),
          (fillerAst) => {
            declaration.initializer = fillerAst as AstNode;
            return ast;
          },
        ],
      ]
    : [];
};
