import { generate, parser } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  IdentifierNode,
  Program,
  DeclarationStatementNode,
  DeclaratorListNode,
  FunctionNode,
  TypeSpecifierNode,
  LiteralNode,
  ParameterDeclarationNode,
  KeywordNode,
} from '@shaderfrog/glsl-parser/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { ComputedInput } from '../graph/parsers';
import { renameBinding } from '@shaderfrog/glsl-parser/parser/utils';
import { ensureFromNode } from 'src/graph';

export interface Texture2DStrategy extends BaseStrategy {
  type: StrategyType.TEXTURE_2D;
}
export const texture2DStrategy = (): Texture2DStrategy => ({
  type: StrategyType.TEXTURE_2D,
  config: {},
});

const isDeclarationStatement = (
  node: Program['program'][0],
): node is DeclarationStatementNode =>
  node.type === 'declaration_statement' &&
  node.declaration.type === 'declarator_list';

export const splargus = (
  ast: Program,
  fromType: string,
  fromVariable: string,
  toVariable: string,
  mainFn?: FunctionNode,
) => {
  if (!ast.scopes[0].bindings[fromVariable]) {
    console.warn(
      `Variable "${fromVariable}" not found in program scope to remove!`,
    );
    return ast;
  }

  ast.program = ast.program.reduce<Program['program']>((stmts, stmt) => {
    if (!isDeclarationStatement(stmt)) {
      return [...stmts, stmt];
    }

    const declaration = stmt.declaration as DeclaratorListNode;
    const { declarations } = declaration;

    if (declarations.length === 1) {
      return stmts;
    } else {
      const decl = stmt.declaration as DeclaratorListNode;
      decl.declarations = decl.declarations.filter(
        (d) => d.identifier.identifier !== fromVariable,
      );
      return [...stmts, stmt];
    }
  }, []);

  if (mainFn) {
    mainFn.prototype.parameters = (mainFn.prototype.parameters || []).concat(
      (
        parser.parse(`void x(${fromType} ${toVariable}) {}`)
          .program[0] as FunctionNode
      ).prototype.parameters,
    );
  }

  ast.scopes[0].bindings[0] = renameBinding(
    ast.scopes[0].bindings[fromVariable],
    toVariable,
  );
  delete ast.scopes[0].bindings[fromVariable];

  return ast;
};

export const applyTexture2DStrategy: ApplyStrategy<Texture2DStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode,
) => {
  let texture2Dcalls: [string, AstNode, string, AstNode[]][] = [];
  const seen: { [key: string]: number } = {};
  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        const identifier = path.node.identifier as IdentifierNode;
        if (
          // TODO: 100 vs 300
          (identifier?.identifier === 'texture2D' ||
            identifier?.identifier === 'texture') &&
          path.key
        ) {
          if (!path.parent) {
            throw new Error(
              'This error is impossible. A function call always has a parent.',
            );
          }

          const name = generate(path.node.args[0]);
          seen[name] = (seen[name] || 0) + 1;
          texture2Dcalls.push([
            name,
            path.parent as AstNode,
            path.key,
            // Remove the first argument and comma to populate fillerArgs
            (path.node.args as AstNode[]).slice(2),
          ]);
        }
      },
    },
  };
  visit(ast, visitors);
  const names = new Set(
    Object.entries(seen).reduce<string[]>(
      (arr, [name, count]) => [...arr, ...(count > 1 ? [name] : [])],
      [],
    ),
  );
  const inputs = texture2Dcalls.map<ComputedInput>(
    ([name, parent, key, texture2dArgs], index) => {
      // Suffix input name if it's used more than once
      const iName = names.has(name) ? `${name}_${index}` : name;
      return [
        nodeInput(
          iName,
          `filler_${iName}`,
          'filler',
          'vector4', // Data type for what plugs into this filler
          ['code', 'data'],
          false,
        ),
        (fillerAst) => {
          // @ts-ignore
          parent[key] = fillerAst;
          return ast;
        },
        texture2dArgs,
      ];
    },
  );

  return inputs;
};
