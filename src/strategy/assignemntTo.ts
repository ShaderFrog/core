import { findAssignmentTo } from '../util/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { AssignmentNode, AstNode } from '@shaderfrog/glsl-parser/ast';

export interface AssignemntToStrategy extends BaseStrategy {
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
): AssignemntToStrategy => ({
  type: StrategyType.ASSIGNMENT_TO,
  config: { assignTo, nth },
});

// Apply the strategy
export const applyAssignmentToStrategy: ApplyStrategy<AssignemntToStrategy> = (
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
          (fillerAst) => {
            if ('expression' in assignNode) {
              (assignNode.expression as AssignmentNode).right =
                fillerAst as AstNode;
            } else {
              assignNode.initializer = fillerAst as AstNode;
            }
            return ast;
          },
        ],
      ]
    : [];
};
