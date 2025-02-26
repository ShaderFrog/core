import { findAssignmentTo } from '../util/ast';
import { nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { AssignmentNode, AstNode } from '@shaderfrog/glsl-parser/ast';

export interface AssignmentToStrategy extends BaseStrategy {
  type: StrategyType.ASSIGNMENT_TO;
  config: {
    assignTo: string;
    nth?: number;
  };
}

// Constructor
export const assignemntToStrategy = (
  assignTo: string,
  nth = 1
): AssignmentToStrategy => ({
  type: StrategyType.ASSIGNMENT_TO,
  config: { assignTo, nth },
});

// Apply the strategy
export const applyAssignmentToStrategy: ApplyStrategy<AssignmentToStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode
) => {
  const assignNode = findAssignmentTo(
    ast,
    strategy.config.assignTo,
    strategy.config.nth || 1
  );

  const name = strategy.config.assignTo;
  return assignNode
    ? [
        [
          nodeInput(
            name,
            `filler_${name}`,
            'filler',
            undefined, // Data type for what plugs into this filler
            ['code', 'data'],
            false
          ),
          (filler) => {
            const filled = filler();
            if ('expression' in assignNode) {
              (assignNode.expression as AssignmentNode).right =
                filled as AstNode;
            } else {
              assignNode.initializer = filled as AstNode;
            }
            return ast;
          },
        ],
      ]
    : [];
};
