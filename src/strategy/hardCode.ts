import { NodeInput } from '../nodes/core-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';

export interface HardCodeStrategy extends BaseStrategy {
  type: StrategyType.HARD_CODE;
  config: { inputs: NodeInput[] };
}
export const hardCodeStrategy = (inputs: NodeInput[]): HardCodeStrategy => ({
  type: StrategyType.HARD_CODE,
  config: { inputs },
});

export const applyHardCodeStrategy: ApplyStrategy<HardCodeStrategy> = (
  graphNode,
  ast,
  strategy
) => {
  return strategy.config.inputs.map((input) => [input, (filler) => filler]);
};
