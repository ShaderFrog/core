import { findDeclarationOf } from '../util/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { AstNode } from '@shaderfrog/glsl-parser/ast';

export const declarationOfStrategy = (
  declarationOf: string,
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
  strategy,
  ast,
  graphNode,
  siblingNode,
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
            ['code', 'data'],
            false,
          ),
          (filler) => {
            declaration.initializer = filler() as AstNode;
            return ast;
          },
        ],
      ]
    : [];
};
