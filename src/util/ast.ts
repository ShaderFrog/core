/**
 * Utility functions to work with ASTs
 */
import { parser, generate } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  ExpressionStatementNode,
  FunctionNode,
  DeclarationStatementNode,
  KeywordNode,
  DeclarationNode,
  AssignmentNode,
  IdentifierNode,
  TypeSpecifierNode,
  DeclaratorListNode,
  FloatConstantNode,
  DoStatementNode,
} from '@shaderfrog/glsl-parser/ast';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { ShaderStage } from '../graph/graph-types';
import { Scope } from '@shaderfrog/glsl-parser/parser/scope';
import { addFnStmtWithIndent } from './whitespace';
import { Filler } from '../graph/parsers';
import { SourceNode } from '../graph';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[31m(core.manipulate)\x1b[0m', ...args);

export interface FrogProgram extends Program {
  outVar?: string;
}

export const findVec4Constructor = (ast: AstNode): AstNode | undefined => {
  let parent: AstNode | undefined;
  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        if (
          (
            (path.node.identifier as TypeSpecifierNode)
              ?.specifier as KeywordNode
          ).token === 'vec4'
        ) {
          parent = path.findParent((p) => 'right' in p.node)?.node;
          path.skip();
        }
      },
    },
  };
  visit(ast, visitors);
  return parent;
};

export const findAssignmentTo = (
  ast: AstNode | Program,
  assignTo: string,
  nth = 1,
) => {
  let assign: ExpressionStatementNode | DeclarationNode | undefined;
  let foundth = 0;
  const visitors: NodeVisitors = {
    expression_statement: {
      enter: (path) => {
        if (
          ((path.node.expression as AssignmentNode)?.left as IdentifierNode)
            ?.identifier === assignTo
        ) {
          foundth++;
          if (foundth === nth) {
            assign = path.node;
            path.stop();
          }
        }
        path.skip();
      },
    },
    declaration_statement: {
      enter: (path) => {
        const foundDecl = (
          path.node.declaration as DeclaratorListNode
        )?.declarations?.find(
          (decl) => decl?.identifier?.identifier === assignTo,
        );
        if (foundDecl?.initializer) {
          foundth++;
          if (foundth === nth) {
            assign = foundDecl;
            path.stop();
          }
        }
        path.skip();
      },
    },
  };
  visit(ast, visitors);
  return assign;
};

export const findDeclarationOf = (
  ast: AstNode | Program,
  declarationOf: string,
): DeclarationNode | undefined => {
  let declaration: DeclarationNode | undefined;
  const visitors: NodeVisitors = {
    declaration_statement: {
      enter: (path) => {
        const foundDecl = (
          path.node.declaration as DeclaratorListNode
        )?.declarations?.find(
          (decl) => decl?.identifier?.identifier === declarationOf,
        );
        if (foundDecl) {
          declaration = foundDecl;
        }
        path.skip();
      },
    },
  };
  visit(ast, visitors);
  return declaration;
};

export const from2To3 = (ast: Program, stage: ShaderStage) => {
  const glOut = 'fragmentColor';
  // TODO: add this back in when there's only one after the merge
  // ast.program.unshift({
  //   type: 'preprocessor',
  //   line: '#version 300 es',
  //   _: '\n',
  // });
  if (stage === 'fragment') {
    ast.program.unshift(
      makeStatement(`out vec4 ${glOut}`) as DeclarationStatementNode,
    );
  }
  visit(ast, {
    function_call: {
      enter: (path) => {
        const identifier = path.node.identifier;
        if (
          identifier.type === 'identifier' &&
          identifier.identifier === 'texture2D'
        ) {
          identifier.identifier = 'texture';
        }
      },
    },
    identifier: {
      enter: (path) => {
        if (path.node.identifier === 'gl_FragColor') {
          path.node.identifier = glOut;
        }
      },
    },
    keyword: {
      enter: (path) => {
        if (
          (path.node.token === 'attribute' || path.node.token === 'varying') &&
          path.findParent((path) => path.node.type === 'declaration_statement')
        ) {
          path.node.token =
            stage === 'vertex' && path.node.token === 'varying' ? 'out' : 'in';
        }
      },
    },
  });
};

export const outDeclaration = (name: string): Object => ({
  type: 'declaration_statement',
  declaration: {
    type: 'declarator_list',
    specified_type: {
      type: 'fully_specified_type',
      qualifiers: [{ type: 'keyword', token: 'out', whitespace: ' ' }],
      specifier: {
        type: 'type_specifier',
        specifier: { type: 'keyword', token: 'vec4', whitespace: ' ' },
        quantifier: null,
      },
    },
    declarations: [
      {
        type: 'declaration',
        identifier: {
          type: 'identifier',
          identifier: name,
          whitespace: undefined,
        },
        quantifier: null,
        operator: undefined,
        initializer: undefined,
      },
    ],
    commas: [],
  },
  semi: { type: 'literal', literal: ';', whitespace: '\n    ' },
});

export const makeStatement = (stmt: string): AstNode => {
  // log(`Parsing "${stmt}"`);
  let ast;
  try {
    ast = parser.parse(
      `${stmt};
`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ stmt, error });
    throw new Error(`Error parsing stmt "${stmt}": ${error?.message}`);
  }
  // log(util.inspect(ast, false, null, true));
  return ast.program[0];
};

export const makeFnStatement = (fnStmt: string): AstNode => {
  let ast;
  try {
    // Create a statement with no trailing nor leading whitespace
    ast = parser.parse(`void main() {${fnStmt};}`, { quiet: true });
  } catch (error: any) {
    console.error({ fnStmt, error });
    throw new Error(`Error parsing fnStmt "${fnStmt}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  const n = (ast.program[0] as FunctionNode).body.statements[0];
  (n as ExpressionStatementNode).semi.whitespace = '';
  return n;
};

export const makeExpression = (expr: string): AstNode => {
  let ast;
  try {
    ast = parser.parse(
      `void main() {
          a = ${expr};
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ expr, error });
    throw new Error(`Error parsing expr "${expr}": ${error?.message}`);
  }

  return (
    (
      (ast.program[0] as FunctionNode).body
        .statements[0] as ExpressionStatementNode
    ).expression as AssignmentNode
  ).right;
};

export const makeExpressionWithScopes = (
  expr: string,
): {
  scope: Scope;
  expression: AstNode;
} => {
  let ast: Program;
  try {
    ast = parser.parse(
      `void main() {
          ${expr};
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ expr, error });
    throw new Error(`Error parsing expr "${expr}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  return {
    scope: ast.scopes[1],
    expression: (
      (ast.program[0] as FunctionNode).body
        .statements[0] as ExpressionStatementNode
    ).expression,
  };
};

export const makeFnBodyStatementWithScopes = (
  body: string,
): {
  scope: Scope;
  statements: AstNode[];
} => {
  let ast: Program;
  try {
    ast = parser.parse(
      `void main() {
${body}
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ body, error });
    throw new Error(`Error parsing body "${body}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  return {
    scope: ast.scopes[1],
    statements: (ast.program[0] as FunctionNode).body.statements,
  };
};

export const findFn =
  (name: string) =>
  (ast: Program): FunctionNode | undefined =>
    ast.program.find(
      (stmt): stmt is FunctionNode =>
        stmt.type === 'function' &&
        stmt.prototype.header.name.identifier === name,
    );

export const returnGlPosition = (fnName: string, ast: Program): void =>
  convertVertexMain(
    fnName,
    ast,
    'vec4',
    (assign) => (assign.expression as AssignmentNode).right,
  );

export const returnGlPositionHardCoded = (
  fnName: string,
  ast: Program,
  returnType: string,
  hardCodedReturn: string,
): void =>
  convertVertexMain(fnName, ast, returnType, () =>
    makeExpression(hardCodedReturn),
  );

export const returnGlPositionVec3Right = (fnName: string, ast: Program): void =>
  convertVertexMain(fnName, ast, 'vec3', (assign) => {
    let found: AstNode | undefined;
    visit(assign, {
      function_call: {
        enter: (path) => {
          const { node } = path;
          if (
            ((node?.identifier as TypeSpecifierNode)?.specifier as KeywordNode)
              ?.token === 'vec4' &&
            (node?.args?.[2] as FloatConstantNode)?.token?.includes('1.')
          ) {
            found = node.args[0];
          }
        },
      },
    });
    if (!found) {
      console.error(generate(ast));
      throw new Error(
        'Could not find position assignment to convert to return!',
      );
    }
    return found;
  });

const convertVertexMain = (
  fnName: string,
  ast: Program,
  returnType: string,
  generateRight: (positionAssign: ExpressionStatementNode) => AstNode,
) => {
  const mainReturnVar = `frogOut`;

  const main = findFn(fnName)(ast);
  if (!main) {
    throw new Error(`No ${fnName} fn found!`);
  }

  // Convert the main function to one that returns
  (main.prototype.header.returnType.specifier.specifier as KeywordNode).token =
    returnType;

  // Find the gl_position assignment line
  const assign = main.body.statements.find(
    (stmt: AstNode): stmt is ExpressionStatementNode =>
      stmt.type === 'expression_statement' &&
      ((stmt.expression as AssignmentNode).left as IdentifierNode)
        ?.identifier === 'gl_Position',
  );
  if (!assign) {
    throw new Error(`No gl position assign found in main fn!`);
  }

  const rtnStmt = makeFnStatement(
    `${returnType} ${mainReturnVar} = 1.0`,
  ) as DeclarationStatementNode;
  (rtnStmt.declaration as DeclaratorListNode).declarations[0].initializer =
    generateRight(assign);

  main.body.statements.splice(main.body.statements.indexOf(assign), 1, rtnStmt);
  main.body.statements = addFnStmtWithIndent(
    main,
    makeFnStatement(`return ${mainReturnVar}`),
  );
};

const frogOutVar = `FROG_OUT`;
export const outVar = (node: SourceNode) => `${frogOutVar}${node.id}`;

export const convert300MainToReturn = (
  mainReturnVar: string,
  ast: FrogProgram,
): void => {
  // Find the output variable, as in "pc_fragColor" from  "out highp vec4 pc_fragColor;"
  let outName: string | undefined;
  ast.program.find((line, index) => {
    const declaration = (line as DeclarationStatementNode)
      ?.declaration as DeclaratorListNode;
    if (
      // line.type === 'declaration_statement' &&
      declaration?.specified_type?.qualifiers?.find(
        (n) => (n as KeywordNode).token === 'out',
      ) &&
      (declaration.specified_type.specifier.specifier as KeywordNode).token ===
        'vec4'
    ) {
      // Remove the out declaration
      ast.program.splice(index, 1);
      outName = declaration.declarations[0].identifier.identifier;
      return true;
    }
  });
  if (!outName) {
    console.error(generate(ast));
    throw new Error('No "out vec4" line found in the fragment shader');
  }

  // @ts-ignore
  ast.outVar = outName;

  ast.program.unshift(
    makeStatement(`vec4 ${mainReturnVar}`) as DeclarationStatementNode,
  );

  visit(ast, {
    function: {
      enter: (path) => {
        if (path.node.prototype.header.name.identifier === 'main') {
          (
            path.node.prototype.header.returnType.specifier
              .specifier as KeywordNode
          ).token = 'vec4';

          path.node.body.statements = addFnStmtWithIndent(
            path.node,
            makeFnStatement(`return ${mainReturnVar}`),
          );
        }
      },
    },
  });
};

export const generateFiller = (filler: Filler) => {
  if (!filler) {
    throw new Error('Cannot generate void filler!');
  }
  return Array.isArray(filler)
    ? filler.map(generate).join('')
    : generate(filler);
};
