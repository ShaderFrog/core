import groupBy from 'lodash.groupby';
import { GlslSyntaxError } from '@shaderfrog/glsl-parser';

import { AstNode, FunctionNode, Program } from '@shaderfrog/glsl-parser/ast';
import {
  Engine,
  EngineContext,
  extendNodeContext,
  extendNodesContext,
} from '../engine';
import { CodeNode, mapInputName, SourceNode, SourceType } from './code-nodes';
import { NodeInput } from './base-node';
import { Graph, GraphNode, NodeType } from './graph-types';
import {
  collectConnectedNodes,
  filterGraphFromNode,
  findLinkedNode,
  findLinkedVertexNodes,
  isSourceNode,
  mangleEntireProgram,
  shouldNodeHaveMainFn,
} from './graph';
import { InputFillerGroup, InputFillers } from '../strategy';
import { coreParsers } from './parsers';
import { findMain } from '../util/ast';

/**
 * A node's context is the runtime / in-memory computed data associated with a
 * graph node. It includes the parsed AST representation of the node, as well as
 * the inputs found in that AST. It's not currently saved to the database.
 */
export type NodeContext = {
  id?: string;
  name?: string;
  computedSource?: string;
  ast: AstNode | Program;
  // Inputs are determined at parse time and should probably be in the graph,
  // not here on the runtime context for the node
  inputs?: NodeInput[];
  inputFillers: InputFillers;
  errors?: NodeErrors;
  mainFn?: FunctionNode;
};

export type NodeContexts = Record<string, NodeContext>;

export type NodeErrors = {
  type: 'errors';
  nodeId: string;
  errors: (GlslSyntaxError | string)[];
};
const makeError = (
  nodeId: string,
  ...errors: (GlslSyntaxError | string)[]
): NodeErrors => ({
  type: 'errors',
  nodeId,
  errors,
});

export const isError = (test: any): test is NodeErrors =>
  test?.type === 'errors';

// Merge existing node inputs, and inputs based on properties, with new ones
// found from the source code, using the *id* as the uniqueness key. Any filler input gets
// merged into property inputs with the same id. This preserves the
// "baked" property on node inputs which is toggle-able in the graph
const collapseNodeInputs = (
  node: CodeNode,
  updatedInputs: NodeInput[]
): NodeInput[] =>
  Object.values(groupBy([...updatedInputs, ...node.inputs], (i) => i.id)).map(
    (dupes) => dupes.reduce((node, dupe) => ({ ...node, ...dupe }))
  );

const computeNodeContext = async (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph,
  node: SourceNode
): Promise<NodeContext | NodeErrors> => {
  // THIS DUPLICATES OTHER LINE
  const parser = {
    ...(coreParsers[node.type] || coreParsers[NodeType.SOURCE]),
    ...(engine.parsers[node.type] || {}),
  };
  const sibling = findLinkedNode(graph, node.id);

  const { onBeforeCompile, manipulateAst } = parser;

  // Save the updated node context if onBeforeCompile() modifies it, which
  // happens if an engine shader generates a computedSource. This is a silly
  // data flow and a TODO: Refactor. This context function should not need to
  // care about the overall engine context nor modifying it. It should only
  // care about generating and returning the individual node context. At least
  // onBeforeCompile(), and maybe others rely on being passed the engine context
  // to mutate it (see cacher() in threngine). This and family of functions
  // should likely be refacted to separate NodeContext and EngineContext, and
  // have this function not modify EngineContext at all.
  let updatedNodeContext;
  let updatedContext = engineContext;
  if (onBeforeCompile) {
    updatedNodeContext = await onBeforeCompile(
      graph,
      engineContext,
      node,
      sibling
    );
    if (updatedNodeContext) {
      updatedContext = extendNodeContext(
        engineContext,
        node.id,
        updatedNodeContext
      );
    }
  }

  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);

  let mainFn: ReturnType<typeof findMain>;
  let ast: ReturnType<typeof parser.produceAst>;
  try {
    ast = parser.produceAst(updatedContext, engine, graph, node, inputEdges);

    // Find the main function before mangling
    if (shouldNodeHaveMainFn(node)) {
      mainFn = findMain(ast as Program);
    }

    if (manipulateAst) {
      ast = manipulateAst(
        updatedContext,
        engine,
        graph,
        ast,
        inputEdges,
        node,
        sibling as SourceNode
      );
    }
  } catch (error) {
    console.error('Error parsing source code!', { error, node });
    return makeError(node.id, error as GlslSyntaxError);
  }

  // Find all the inputs of this node where a "source" code node flows into it,
  // to auto-bake it. This handles the case where a graph is instantiated with
  // a shader plugged into a texture property. The property on the intial node
  // doesn't know if it's baked or not
  const dataInputs = groupBy(
    filterGraphFromNode(
      graph,
      node,
      {
        input: (input, b, c, fromNode) =>
          input.bakeable && fromNode?.type === 'source',
      },
      1
    ).inputs[node.id] || [],
    'id'
  );

  // Find the combination if inputs (data) and fillers (runtime context data)
  // and copy the input data onto the node, and the fillers onto the context
  const computedInputs = parser.findInputs(
    updatedContext,
    ast,
    inputEdges,
    node,
    sibling
  );

  node.inputs = collapseNodeInputs(
    node,
    computedInputs.map(([i]) => ({
      ...i,
      displayName: mapInputName(node, i),
    }))
  ).map((input) => ({
    // Auto-bake
    ...input,
    ...(input.id in dataInputs ? { baked: true } : {}),
  }));

  // Skip mangling if the node tells us to, which probably means it's an engine
  // node where we don't care about renaming all the variables, or if it's
  // an expression, where we want to be in the context of other variables
  // TODO: Use global undefined engine variables here?
  if (
    node.config.mangle !== false &&
    node.sourceType !== SourceType.EXPRESSION &&
    node.sourceType !== SourceType.FN_BODY_FRAGMENT
  ) {
    mangleEntireProgram(
      engine,
      ast as Program,
      node,
      findLinkedNode(graph, node.id)
    );
  }

  const nodeContext: NodeContext = {
    ...(updatedNodeContext || {}),
    ast,
    id: node.id,
    mainFn,
    inputFillers: computedInputs.reduce<InputFillers>(
      (acc, [input, filler, fillerArgs, fillerStmt]) => {
        // This is intentionally broken out into an explicit return to force
        // this type declaration. Inlining the object in [input.id]: {...}
        // doesn't force it to be an InputFillerGroup, and it can contain extra
        // arguments by accident
        const fillerGroup: InputFillerGroup = {
          filler,
          fillerArgs,
          fillerStmt,
        };
        return {
          ...acc,
          [input.id]: fillerGroup,
        };
      },
      {}
    ),
  };

  return nodeContext;
};

export const computeContextForNodes = async (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph,
  nodes: GraphNode[]
) =>
  nodes
    .filter(isSourceNode)
    .reduce<Promise<NodeContexts | NodeErrors>>(async (ctx, node) => {
      const context = await ctx;
      if (isError(context)) {
        return context;
      }

      let nodeContextOrError = await computeNodeContext(
        engineContext,
        engine,
        graph,
        node
      );
      if (isError(nodeContextOrError)) {
        return nodeContextOrError;
      }

      return {
        ...context,
        [node.id]: {
          ...(context[node.id] || {}),
          ...nodeContextOrError,
        },
      };
    }, Promise.resolve(engineContext.nodes as NodeContexts));

/**
 * Compute the context for every node in the graph, done on initial graph load
 * to compute the inputs/outputs for every node
 */
export const computeAllContexts = async (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph
) => await computeContextForNodes(engineContext, engine, graph, graph.nodes);

/**
 * Compute the contexts for nodes starting from the outputs, working backwards.
 * Used to only (re)-compute context for any actively used nodes
 */
export const computeGraphContext = async (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph
) => {
  const outputFrag = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'fragment'
  );
  if (!outputFrag) {
    throw new Error('No fragment output in graph');
  }
  const outputVert = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'vertex'
  );
  if (!outputVert) {
    throw new Error('No vertex output in graph');
  }

  const vertexes = collectConnectedNodes(graph, outputVert);
  const fragments = collectConnectedNodes(graph, outputFrag);

  // collectConnectedNodes includes the link between fragment and vertex. To
  // avoid duplicate context, track the vertex IDs and ignore them later.
  const vertexIds = new Set(Object.keys(vertexes));

  // Find any unconnected vertex nodes linked to collected fragment nodes
  const unlinkedNodes = findLinkedVertexNodes(graph, vertexes);

  const vertNodesOrError = await computeContextForNodes(
    engineContext,
    engine,
    graph,
    [
      outputVert,
      ...Object.values(vertexes).filter((node) => node.id !== outputVert.id),
      ...unlinkedNodes,
    ]
  );
  if (isError(vertNodesOrError)) {
    return vertNodesOrError;
  }

  const updatedContext = extendNodesContext(engineContext, vertNodesOrError);
  const finalNodeContextOrError = await computeContextForNodes(
    updatedContext,
    engine,
    graph,
    [
      outputFrag,
      ...Object.values(fragments).filter(
        (node) => node.id !== outputFrag.id && !vertexIds.has(node.id)
      ),
    ]
  );

  return finalNodeContextOrError;
};
