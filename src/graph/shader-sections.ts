/**
 * Categorizing / deduping parts of shaders to help merge them together
 */
import {
  AstNode,
  DeclarationStatementNode,
  DeclaratorListNode,
  InterfaceDeclaratorNode,
  KeywordNode,
  PreprocessorNode,
  ProgramStatement,
} from '@shaderfrog/glsl-parser/ast';
import { generate } from '@shaderfrog/glsl-parser';
import { makeStatement } from '../util/ast';
import { Program } from '@shaderfrog/glsl-parser/ast';

export type LineAndSource<T = any> = { nodeId: string; source: T };

export function extractSource<T>(lineAndSource: LineAndSource<T>): T;
export function extractSource<T>(lineAndSource: LineAndSource<T>[]): T[];
export function extractSource<T>(
  lineAndSource: LineAndSource<T> | LineAndSource<T>[]
): T | T[] {
  return Array.isArray(lineAndSource)
    ? lineAndSource.map((l) => l.source)
    : lineAndSource.source;
}

export interface ShaderSections {
  precision: LineAndSource<DeclarationStatementNode>[];
  version: LineAndSource<PreprocessorNode>[];
  preprocessor: LineAndSource<PreprocessorNode>[];
  structs: LineAndSource<DeclarationStatementNode>[];
  inStatements: LineAndSource<DeclarationStatementNode>[];
  outStatements: LineAndSource<DeclarationStatementNode>[];
  uniforms: LineAndSource<DeclarationStatementNode>[];
  program: LineAndSource<ProgramStatement>[];
}

export const filterSections = (
  filter: (s: LineAndSource) => boolean,
  sections: ShaderSections
): ShaderSections => ({
  precision: sections.precision.filter(filter),
  version: sections.version.filter(filter),
  preprocessor: sections.preprocessor.filter(filter),
  structs: sections.structs.filter(filter),
  inStatements: sections.inStatements.filter(filter),
  outStatements: sections.outStatements.filter(filter),
  uniforms: sections.uniforms.filter(filter),
  program: sections.program.filter(filter),
});

export const mapSections = (
  map: (s: LineAndSource) => LineAndSource,
  sections: ShaderSections
): ShaderSections => ({
  precision: sections.precision.map(map),
  version: sections.version.map(map),
  preprocessor: sections.preprocessor.map(map),
  structs: sections.structs.map(map),
  inStatements: sections.inStatements.map(map),
  outStatements: sections.outStatements.map(map),
  uniforms: sections.uniforms.map(map),
  program: sections.program.map(map),
});

export const shaderSectionsCons = (): ShaderSections => ({
  precision: [],
  preprocessor: [],
  version: [],
  structs: [],
  program: [],
  inStatements: [],
  outStatements: [],
  uniforms: [],
});

enum Precision {
  highp = 2,
  mediump = 1,
  lowp = 0,
}

export const higherPrecision = (p1: Precision, p2: Precision): Precision =>
  Precision[p1] > Precision[p2] ? p1 : p2;

export const dedupeVersions = (nodes: PreprocessorNode[]) => nodes[0];

export const highestPrecisions = (
  nodes: DeclarationStatementNode[]
): DeclarationStatementNode[] =>
  Object.entries(
    nodes.reduce(
      (precisions, stmt) => ({
        ...precisions,
        // Like "float"
        [(stmt.declaration as any).specifier.specifier.token]: higherPrecision(
          precisions[(stmt.declaration as any).specifier.specifier.token],
          (stmt.declaration as any).qualifier.token
        ),
      }),
      {} as { [type: string]: Precision }
    )
  ).map(
    ([typeName, precision]) =>
      makeStatement(
        `precision ${precision} ${typeName}`
      )[0] as DeclarationStatementNode
  );

export const extractDeclarationNameAndType = (
  stmt: DeclarationStatementNode
) => {
  const dec = stmt.declaration as DeclaratorListNode;
  return {
    type: (dec.specified_type.specifier.specifier as KeywordNode).token,
    names: dec.declarations.map((decl) => decl.identifier.identifier),
  };
};

export const filterQualifiedStatements = (
  statements: LineAndSource<DeclarationStatementNode>[],
  filter: (name: string) => boolean
) =>
  statements.reduce<LineAndSource<DeclarationStatementNode>[]>((acc, line) => {
    const stmt = line.source;
    const dec = stmt.declaration as DeclaratorListNode;
    const filtered = dec.declarations.filter((decl) =>
      filter(decl.identifier.identifier)
    );
    return filtered.length
      ? acc.concat({
          ...line,
          source: {
            ...line.source,
            declaration: {
              ...dec,
              declarations: filtered,
            },
          },
        })
      : acc;
  }, []);

export const dedupeQualifiedStatements = (
  statements: DeclarationStatementNode[],
  qualifier: string
) =>
  Object.entries(
    statements.reduce<{ [typeName: string]: Set<string> }>((indexed, stmt) => {
      const { type, names } = extractDeclarationNameAndType(stmt);
      return {
        ...indexed,
        [type]: new Set([...(indexed[type] || new Set<string>()), ...names]),
      };
    }, {})
  ).map(
    ([type, varNames]) =>
      makeStatement(
        `${qualifier} ${type} ${Array.from(varNames).join(', ')}`
      )[0]
  );

/**
 * Remove uniform declarations by the variable names they declare
 */
export const filterUniformNames = (
  declarations: LineAndSource<DeclarationStatementNode>[],
  filter: (name: string) => boolean
) => {
  return declarations.reduce<LineAndSource<DeclarationStatementNode>[]>(
    (acc, line) => {
      const decl = line.source.declaration;

      // Struct declarations like "uniform Light0 { vec4 y; } x;"
      if (decl.type === 'interface_declarator') {
        const identifier = decl.identifier?.identifier?.identifier;
        // If there are no remaining declarations, remove the whole line
        return !identifier || !filter(identifier) ? acc : [...acc, line];
        // Standard uniform declaration, like "uniform vec4 x, y;"
      } else if (decl.type === 'declarator_list') {
        const filtered = decl.declarations.filter((d) =>
          filter(d.identifier.identifier)
        );
        // If there are no remaining decalrations, remove the whole line.
        // Otherwise, update the line to remove the filtered out names
        return filtered.length
          ? acc.concat({
              ...line,
              source: {
                ...line.source,
                declaration: { ...decl, declarations: filtered },
              },
            })
          : acc;
      } else {
        console.error('Unknown uniform declaration type to filter:', decl);
        throw new Error(
          `Unknown uniform declarationt type to filter: "${decl.type}"`
        );
      }
    },
    []
  );
};

type UniformName = Record<string, { generated: string; hasInterface: boolean }>;
type UniformGroup = Record<string, UniformName>;

/**
 * Merge uniforms together into lists of identifiers under the same type.
 * There's special case handling for mixing of uniforms with "interface blocks"
 * and those without when merging to make sure the interface block definition is
 * preserved. Check out the tests for more.
 *
 * This function consumes uniforms as found by findShaderSections, so the
 * definitions must line up
 */
export const dedupeUniforms = (statements: DeclarationStatementNode[]) => {
  const groupedByTypeName = Object.entries(
    statements.reduce<UniformGroup>((stmts, stmt) => {
      const decl = stmt.declaration;

      // This is the standard case, a uniform like "uniform vec2 x"
      if ('specified_type' in decl) {
        const { specified_type } = decl;
        const { specifier } = specified_type.specifier;
        // Token is for "vec2", "identifier" is for custom names like struct
        const type =
          'token' in specifier
            ? specifier.token
            : 'identifier' in specifier
            ? specifier.identifier
            : undefined;
        if (!type) {
          console.error('Unknown statement: ', stmt);
          throw new Error(`Unknown specifier: ${specifier.type}`);
        }

        // Groups uniforms into their return type, and for each type, collapses
        // uniform names into an object where the keys determine uniqueness
        // "vec2": { x: x[1] }
        const grouped = decl.declarations.reduce<UniformName>((types, decl) => {
          const { identifier } = decl;

          let quantifier = '';
          if (decl.quantifier) {
            if (!('token' in decl.quantifier[0].expression)) {
              console.error('Unknown expression in quantifier: ', decl);
              throw new Error(
                `Unknown expression in quantifier: ${generate(decl)}`
              );
            }
            quantifier = `[${decl.quantifier[0].expression.token}]`;
          }
          return {
            ...types,
            // There's probably a bug here where one shader declares x[1],
            // another declares x[2], they both get collapsed under "x",
            // and one is wrong
            [identifier.identifier]: stmts[type]?.[identifier.identifier]
              ?.hasInterface
              ? stmts[type]?.[identifier.identifier]
              : {
                  hasInterface: false,
                  generated: identifier.identifier + quantifier,
                },
          };
        }, {});

        return {
          ...stmts,
          [type]: {
            ...(stmts[type] || {}),
            ...grouped,
          },
        };
        // This is the less common case, a uniform like "uniform Light { vec3 position; } name"
      } else if ('interface_type' in decl) {
        const { interface_type, identifier } = decl;

        // If this is an interface block only, like uniform Scene { mat4 view; };
        // then group the interface block declaration under ''
        const interfaceDeclaredUniform =
          identifier?.identifier?.identifier || '';

        const node = {
          type: 'interface_declarator',
          lp: decl.lp,
          declarations: decl.declarations,
          qualifiers: [],
          // This is non-nullable, to produce "X" in "uniform X { ... } varName"
          // But it appears "X" is in declarations above
          interface_type: {
            type: 'identifier',
            identifier: '',
            whitespace: '',
          },
          rp: decl.rp,
        } as InterfaceDeclaratorNode;

        return {
          ...stmts,
          [interface_type.identifier]: {
            [interfaceDeclaredUniform]: {
              generated: `${generate(node)}${interfaceDeclaredUniform}`,
              hasInterface: true,
            },
          },
        };
      } else {
        console.error('Unknown uniform AST', { stmt, code: generate(stmt) });
        throw new Error(
          'Unknown uniform AST encountered when merging uniforms'
        );
      }
    }, {})
  );

  return groupedByTypeName.map(([type, variables]) => {
    return makeStatement(
      `uniform ${type} ${Object.values(variables)
        .map((v) => v.generated)
        .join(', ')}`
    )[0] as DeclarationStatementNode;
  });
};

export const mergeShaderSections = (
  s1: ShaderSections,
  s2: ShaderSections
): ShaderSections => {
  return {
    version: [...s1.version, ...s2.version],
    precision: [...s1.precision, ...s2.precision],
    preprocessor: [...s1.preprocessor, ...s2.preprocessor],
    inStatements: [...s1.inStatements, ...s2.inStatements],
    outStatements: [...s1.outStatements, ...s2.outStatements],
    structs: [...s1.structs, ...s2.structs],
    uniforms: [...s1.uniforms, ...s2.uniforms],
    program: [...s1.program, ...s2.program],
  };
};

export type MergeOptions = {
  includePrecisions: boolean;
  includeVersion: boolean;
};

export const shaderSectionsToProgram = (
  sections: ShaderSections,
  mergeOptions: MergeOptions
): Program => ({
  type: 'program',
  scopes: [],
  program: [
    ...(mergeOptions.includeVersion
      ? [dedupeVersions(extractSource(sections.version))]
      : []),
    ...(mergeOptions.includePrecisions
      ? highestPrecisions(extractSource(sections.precision))
      : []),
    ...extractSource(sections.preprocessor),
    // // Structs before ins and uniforms as they can reference structs
    ...extractSource(sections.structs),
    ...dedupeQualifiedStatements(extractSource(sections.inStatements), 'in'),
    ...dedupeQualifiedStatements(extractSource(sections.outStatements), 'out'),
    ...dedupeUniforms(extractSource(sections.uniforms)),
    ...extractSource(sections.program),
  ],
});

/**
 * Group an AST into logical sections. The output of this funciton is consumed
 * by the dedupe methods, namely dedupeUniforms, so the data shapes are coupled
 */
export const findShaderSections = (
  nodeId: string,
  ast: Program
): ShaderSections => {
  const initialValue: ShaderSections = {
    precision: [],
    preprocessor: [],
    version: [],
    structs: [],
    inStatements: [],
    outStatements: [],
    uniforms: [],
    program: [],
  };

  return ast.program.reduce((sections, node) => {
    if (node.type === 'preprocessor' && node.line.startsWith('#version')) {
      return {
        ...sections,
        version: sections.version.concat({ nodeId, source: node }),
      };
    } else if (
      node.type === 'declaration_statement' &&
      node.declaration.type === 'precision'
    ) {
      return {
        ...sections,
        precision: sections.precision.concat({ nodeId, source: node }),
      };
    } else if (node.type === 'preprocessor') {
      return {
        ...sections,
        preprocessor: sections.preprocessor.concat({ nodeId, source: node }),
      };
    } else if (
      node.type === 'declaration_statement' &&
      node.declaration.type === 'declarator_list' &&
      node.declaration?.specified_type?.specifier?.specifier?.type === 'struct'
    ) {
      return {
        ...sections,
        structs: sections.structs.concat({ nodeId, source: node }),
      };
      // This definition of a uniform lines up with the processing we do in
      // dedupeUniforms
    } else if (
      node.type === 'declaration_statement' &&
      // Ignore lines like "layout(std140,column_major) uniform;"
      !(
        'qualifiers' in node.declaration &&
        node.declaration?.qualifiers?.find((q) => 'layout' in q)
      ) &&
      // One of these checks is for a uniform with an interface block, and the
      // other is for vanilla uniforms. I don't remember which is which
      (('specified_type' in node.declaration &&
        'qualifiers' in node.declaration.specified_type &&
        node.declaration.specified_type.qualifiers?.find(
          (n) => 'token' in n && n.token === 'uniform'
        )) ||
        ('qualifiers' in node.declaration &&
          node.declaration?.qualifiers?.find(
            (n) => 'token' in n && n.token === 'uniform'
          )))
    ) {
      return {
        ...sections,
        uniforms: sections.uniforms.concat({ nodeId, source: node }),
      };
    } else if (
      node.type === 'declaration_statement' &&
      'specified_type' in node.declaration &&
      node.declaration?.specified_type?.qualifiers?.find(
        (n) => 'token' in n && n.token === 'in'
      )
    ) {
      return {
        ...sections,
        inStatements: sections.inStatements.concat({ nodeId, source: node }),
      };
    } else if (
      node.type === 'declaration_statement' &&
      'specified_type' in node.declaration &&
      node.declaration?.specified_type?.qualifiers?.find(
        (n) => 'token' in n && n.token === 'out'
      )
    ) {
      return {
        ...sections,
        outStatements: sections.outStatements.concat({ nodeId, source: node }),
      };
    } else {
      return {
        ...sections,
        program: sections.program.concat({ nodeId, source: node }),
      };
    }
  }, initialValue);
};
