import { renameBindings } from '@shaderfrog/glsl-parser/parser/utils';
import { EngineImporters, EngineNodeType } from '../../engine';

const nodeInputMap = {
  normalMap: 'bumpSampler',
  property_map: 'property_albedoTexture',
  property_normalMap: 'property_bumpTexture',
  property_color: 'property_albedoColor',
  property_metalness: 'property_metallic',
  filler_position: 'filler_position',
};

const importers: EngineImporters = {
  three: {
    convertAst(ast, type) {
      throw new Error('Not implemented');
    },
    nodeInputMap: {
      [EngineNodeType.physical]: nodeInputMap,
    },
    edgeMap: {
      normalMap: 'bumpSampler',
      property_map: 'property_albedoTexture',
      property_normalMap: 'property_bumpTexture',
      property_color: 'property_albedoColor',
      property_metalness: 'property_metallic',
    },
  },
};

export default importers;
