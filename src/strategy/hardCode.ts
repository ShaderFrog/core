import { NodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { ComputedInput } from '../graph/parsers';

/**
 * I don't actually know if anything uses this, nor do I remember how it would
 * be used, since the filler strategy has no effect on the AST. TODO: Remove
 * this strategy if no one uses it!
 */
export interface HardCodeStrategy extends BaseStrategy {
  type: StrategyType.HARD_CODE_INPUTS;
  config: { inputs: NodeInput[] };
}
export const hardCodeStrategy = (inputs: NodeInput[]): HardCodeStrategy => ({
  type: StrategyType.HARD_CODE_INPUTS,
  config: { inputs },
});

export const applyHardCodeStrategy: ApplyStrategy<HardCodeStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode
) =>
  strategy.config.inputs.map((input) => {
    // Broken out into two lines to enforce type checking on the array.
    const ci: ComputedInput = [
      input,
      // Fillers have to return AstNode | Program, and filler is type Filler,
      // so this awkward branch is to make types line up. But I don't think
      // this code path would ever get called
      (filler) => {
        if (!filler || Array.isArray(filler)) {
          throw new Error('Cannot use void filler');
        }
        return filler;
      },
    ];
    return ci;
  });
