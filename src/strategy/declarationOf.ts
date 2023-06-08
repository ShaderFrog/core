import { findDeclarationOf } from '../ast/manipulate';
import { InputCategory, nodeInput } from '../nodes/core-node';
import { BaseStrategy, StrategyImpl, StrategyType } from '.';

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

export const constApplyDeclarationOf: StrategyImpl = (node, ast, strategy) => {
  const cast = strategy as DeclarationOfStrategy;
  const declaration = findDeclarationOf(ast, cast.config.declarationOf);
  const name = cast.config.declarationOf;
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
            declaration.initializer = fillerAst;
            return ast;
          },
        ],
      ]
    : [];
};
