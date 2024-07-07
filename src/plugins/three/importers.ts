import { renameBindings } from '@shaderfrog/glsl-parser/parser/utils';
import { EngineImporters } from '../../engine';

const importers: EngineImporters = {
  babylon: {
    convertAst: (ast, type?) => {
      ast.scopes[0].bindings = renameBindings(ast.scopes[0].bindings, (name) =>
        name === 'vMainUV1' ? 'vUv' : name === 'vNormalW' ? 'vNormal' : name,
      );
    },
    nodeInputMap: {},
    edgeMap: {
      bumpSampler: 'normalMap',
    },
  },
};

export default importers;
