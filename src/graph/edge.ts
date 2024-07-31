import { EdgeLink, LinkHandle, ShaderStage } from './graph-types';
import { GraphDataType } from './data-nodes';

export type EdgeType = ShaderStage | GraphDataType | EdgeLink;

export type Edge = {
  id: string;
  from: string;
  to: string;
  output: string;
  // The ID of the input of the node this edge connects to
  input: string;
  // Fragment, vertex, or any of the data types
  // TODO: I think edge should have a *stage* and a *dataType* rather than a
  // type that hides both together
  type?: EdgeType;
};

export const makeEdge = (
  id: string,
  from: string,
  to: string,
  output: string,
  input: string,
  type?: EdgeType,
): Edge => ({ id, from, to, output, input, type });

export const linkFromVertToFrag = (
  id: string,
  vertId: string,
  fragId: string,
) =>
  makeEdge(
    id,
    vertId,
    fragId,
    LinkHandle.NEXT_STAGE, // output from next_stage
    LinkHandle.PREVIOUS_STAGE, // input to previous_stage
    EdgeLink.NEXT_STAGE,
  );
