import { findAssignmentTo } from '../ast/manipulate';
import { InputCategory, nodeInput } from '../nodes/core-node';
import { BaseStrategy, StrategyImpl, StrategyType } from '.';

export interface AssignemntToStrategy extends BaseStrategy {
  type: StrategyType.ASSIGNMENT_TO;
  config: {
    assignTo: string;
  };
}

// Constructor
export const assignemntToStrategy = (
  assignTo: string
): AssignemntToStrategy => ({
  type: StrategyType.ASSIGNMENT_TO,
  config: { assignTo },
});

// Apply the strategy
export const applyAssignmentToStrategy: StrategyImpl = (
  node,
  ast,
  strategy
) => {
  const cast = strategy as AssignemntToStrategy;
  const assignNode = findAssignmentTo(ast, cast.config.assignTo);

  const name = cast.config.assignTo;
  return assignNode
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
            assignNode.expression.right = fillerAst;
            return ast;
          },
        ],
      ]
    : [];
};
