import * as macro from '../../../macro';
import vtkHelper from '../Helper';
import vtkMath from '../../../Common/Core/Math';
import vtkShaderProgram from '../ShaderProgram';
import vtkViewNode from '../../SceneGraph/ViewNode';
import { REPRESENTATIONS, SHADINGS } from '../../Core/Property/Constants';

import vtkPolyDataVS from '../glsl/vtkPolyDataVS.c';
import vtkPolyDataFS from '../glsl/vtkPolyDataFS.c';

// ----------------------------------------------------------------------------
// vtkOpenGLPolyDataMapper methods
// ----------------------------------------------------------------------------

export function vtkOpenGLPolyDataMapper(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkOpenGLPolyDataMapper');

  // Builds myself.
  publicAPI.build = (prepass) => {
    if (prepass) {
      if (!model.renderable) {
        return;
      }
    }
  };

  // Renders myself
  publicAPI.render = (prepass) => {
    if (prepass) {
      model.openglRenderWindow = publicAPI.getFirstAncestorOfType('vtkOpenGLRenderWindow');
      model.context = model.openglRenderWindow.getContext();
      model.points.setContext(model.context);
      model.lines.setContext(model.context);
      model.tris.setContext(model.context);
      model.triStrips.setContext(model.context);
      const actor = publicAPI.getFirstAncestorOfType('vtkOpenGLActor').getRenderable();
      const openglRenderer = publicAPI.getFirstAncestorOfType('vtkOpenGLRenderer');
      const ren = openglRenderer.getRenderable();
      model.openglCamera = openglRenderer.getViewNodeFor(ren.getActiveCamera());
      publicAPI.renderPiece(ren, actor);
    } else {
      // something
    }
  };

  publicAPI.buildShaders = (shaders, ren, actor) => {
    publicAPI.getShaderTemplate(shaders, ren, actor);
    publicAPI.replaceShaderValues(shaders, ren, actor);
  };

  publicAPI.getShaderTemplate = (shaders, ren, actor) => {
    shaders.Vertex = vtkPolyDataVS;
    shaders.Fragment = vtkPolyDataFS;
    shaders.Geometry = '';
  };

  publicAPI.replaceShaderColor = (shaders, ren, actor) => {
    let FSSource = shaders.Fragment;

    const lastLightComplexity = model.lastLightComplexity.get(model.lastBoundBO);

    // create the material/color property declarations, and VS implementation
    // these are always defined
    let colorDec = [
      'uniform float opacityUniform; // the fragment opacity',
      'uniform vec3 ambientColorUniform; // intensity weighted color',
      'uniform vec3 diffuseColorUniform; // intensity weighted color'];
    // add more for specular
    if (lastLightComplexity) {
      colorDec = colorDec.concat([
        'uniform vec3 specularColorUniform; // intensity weighted color',
        'uniform float specularPowerUniform;']);
    }
    FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Color::Dec',
      colorDec).result;

    // now handle the more complex fragment shader implementation
    // the following are always defined variables.  We start
    // by assiging a default value from the uniform
    let colorImpl = [
      'vec3 ambientColor;',
      '  vec3 diffuseColor;',
      '  float opacity;'];
    if (lastLightComplexity) {
      colorImpl = colorImpl.concat([
        '  vec3 specularColor;',
        '  float specularPower;']);
    }
    colorImpl = colorImpl.concat([
      '  ambientColor = ambientColorUniform;',
      '  diffuseColor = diffuseColorUniform;',
      '  opacity = opacityUniform;']);
    if (lastLightComplexity) {
      colorImpl = colorImpl.concat([
        '  specularColor = specularColorUniform;',
        '  specularPower = specularPowerUniform;']);
    }

    FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Color::Impl', colorImpl).result;

    shaders.Fragment = FSSource;
  };

  publicAPI.replaceShaderLight = (shaders, ren, actor) => {
    let FSSource = shaders.Fragment;

    // check for shadow maps
    const shadowFactor = '';

    const lastLightComplexity = model.lastLightComplexity.get(model.lastBoundBO);

    switch (lastLightComplexity) {
      case 0: // no lighting or RENDER_VALUES
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Impl', [
          '  gl_FragData[0] = vec4(ambientColor + diffuseColor, opacity);',
          '  //VTK::Light::Impl'],
        false
        ).result;
        break;

      case 1:  // headlight
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Impl', [
          '  float df = max(0.0, normalVCVSOutput.z);',
          '  float sf = pow(df, specularPower);',
          '  vec3 diffuse = df * diffuseColor;',
          '  vec3 specular = sf * specularColor;',
          '  gl_FragData[0] = vec4(ambientColor + diffuse + specular, opacity);',
          '  //VTK::Light::Impl'],
          false).result;
        break;

      case 2: // light kit
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Dec', [
          // only allow for up to 6 active lights
          'uniform int numberOfLights;',
          // intensity weighted color
          'uniform vec3 lightColor[6];',
          'uniform vec3 lightDirectionVC[6]; // normalized',
          'uniform vec3 lightHalfAngleVC[6]; // normalized']).result;
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Impl', [
          'vec3 diffuse = vec3(0,0,0);',
          '  vec3 specular = vec3(0,0,0);',
          '  for (int lightNum = 0; lightNum < numberOfLights; lightNum++)',
          '    {',
          '    float df = max(0.0, dot(normalVCVSOutput, -lightDirectionVC[lightNum]));',
          `    diffuse += ((df${shadowFactor}) * lightColor[lightNum]);`,
          '    if (dot(normalVCVSOutput, lightDirectionVC[lightNum]) < 0.0)',
          '      {',
          '      float sf = pow( max(0.0, dot(lightHalfAngleVC[lightNum],normalVCVSOutput)), specularPower);',
          `      specular += ((sf${shadowFactor}) * lightColor[lightNum]);`,
          '      }',
          '    }',
          '  diffuse = diffuse * diffuseColor;',
          '  specular = specular * specularColor;',
          '  gl_FragData[0] = vec4(ambientColor + diffuse + specular, opacity);',
          '  //VTK::Light::Impl'],
          false
          ).result;
        break;

      case 3: // positional
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Dec', [
          // only allow for up to 6 active lights
          'uniform int numberOfLights;',
          // intensity weighted color
          'uniform vec3 lightColor[6];',
          'uniform vec3 lightDirectionVC[6]; // normalized',
          'uniform vec3 lightHalfAngleVC[6]; // normalized',
          'uniform vec3 lightPositionVC[6];',
          'uniform vec3 lightAttenuation[6];',
          'uniform float lightConeAngle[6];',
          'uniform float lightExponent[6];',
          'uniform int lightPositional[6];']
        ).result;
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Light::Impl', [
          '  vec3 diffuse = vec3(0,0,0);',
          '  vec3 specular = vec3(0,0,0);',
          '  vec3 vertLightDirectionVC;',
          '  for (int lightNum = 0; lightNum < numberOfLights; lightNum++)',
          '    {',
          '    float attenuation = 1.0;',
          '    if (lightPositional[lightNum] == 0)',
          '      {',
          '      vertLightDirectionVC = lightDirectionVC[lightNum];',
          '      }',
          '    else',
          '      {',
          '      vertLightDirectionVC = vertexVC.xyz - lightPositionVC[lightNum];',
          '      float distanceVC = length(vertLightDirectionVC);',
          '      vertLightDirectionVC = normalize(vertLightDirectionVC);',
          '      attenuation = 1.0 /',
          '        (lightAttenuation[lightNum].x',
          '         + lightAttenuation[lightNum].y * distanceVC',
          '         + lightAttenuation[lightNum].z * distanceVC * distanceVC);',
          '      // per OpenGL standard cone angle is 90 or less for a spot light',
          '      if (lightConeAngle[lightNum] <= 90.0)',
          '        {',
          '        float coneDot = dot(vertLightDirectionVC, lightDirectionVC[lightNum]);',
          '        // if inside the cone',
          '        if (coneDot >= cos(radians(lightConeAngle[lightNum])))',
          '          {',
          '          attenuation = attenuation * pow(coneDot, lightExponent[lightNum]);',
          '          }',
          '        else',
          '          {',
          '          attenuation = 0.0;',
          '          }',
          '        }',
          '      }',
          '    float df = max(0.0, attenuation*dot(normalVCVSOutput, -vertLightDirectionVC));',
          `    diffuse += ((df${shadowFactor}) * lightColor[lightNum]);`,
          '    if (dot(normalVCVSOutput, vertLightDirectionVC) < 0.0)',
          '      {',
          '      float sf = attenuation*pow( max(0.0, dot(lightHalfAngleVC[lightNum],normalVCVSOutput)), specularPower);',
          `      specular += ((sf${shadowFactor}) * lightColor[lightNum]);`,
          '      }',
          '    }',
          '  diffuse = diffuse * diffuseColor;',
          '  specular = specular * specularColor;',
          '  gl_FragData[0] = vec4(ambientColor + diffuse + specular, opacity);',
          '  //VTK::Light::Impl'],
          false
          ).result;
        break;
      default:
        vtkErrorMacro('bad light complexity');
    }

    shaders.Fragment = FSSource;
  };

  publicAPI.replaceShaderNormal = (shaders, ren, actor) => {
    if (model.lastLightComplexity.get(model.lastBoundBO) > 0) {
      let VSSource = shaders.Vertex;
      let GSSource = shaders.Geometry;
      let FSSource = shaders.Fragment;

      if (model.lastBoundBO.getCABO().getNormalOffset()) {
        VSSource = vtkShaderProgram.substitute(VSSource,
          '//VTK::Normal::Dec', [
            'attribute vec3 normalMC;',
            'uniform mat3 normalMatrix;',
            'varying vec3 normalVCVSOutput;']).result;
        VSSource = vtkShaderProgram.substitute(VSSource,
          '//VTK::Normal::Impl', [
            'normalVCVSOutput = normalMatrix * normalMC;']).result;
        GSSource = vtkShaderProgram.substitute(GSSource,
          '//VTK::Normal::Dec', [
            'in vec3 normalVCVSOutput[];',
            'out vec3 normalVCGSOutput;']).result;
        GSSource = vtkShaderProgram.substitute(GSSource,
          '//VTK::Normal::Impl', [
            'normalVCGSOutput = normalVCVSOutput[i];']).result;
        FSSource = vtkShaderProgram.substitute(FSSource,
          '//VTK::Normal::Dec', [
            'varying vec3 normalVCVSOutput;']).result;
        FSSource = vtkShaderProgram.substitute(FSSource,
          '//VTK::Normal::Impl', [
            'vec3 normalVCVSOutput = normalize(normalVCVSOutput);',
            //  if (!gl_FrontFacing) does not work in intel hd4000 mac
            //  if (int(gl_FrontFacing) == 0) does not work on mesa
            '  if (gl_FrontFacing == false) { normalVCVSOutput = -normalVCVSOutput; }']
          ).result;
      } else {
        if (model.haveCellNormals) {
          FSSource = vtkShaderProgram.substitute(FSSource,
            '//VTK::Normal::Dec', [
              'uniform mat3 normalMatrix;',
              'uniform samplerBuffer textureN;']).result;
          FSSource = vtkShaderProgram.substitute(FSSource,
            '//VTK::Normal::Impl', [
              'vec3 normalVCVSOutput = normalize(normalMatrix *',
              '    texelFetchBuffer(textureN, gl_PrimitiveID + PrimitiveIDOffset).xyz);',
              '  if (gl_FrontFacing == false) { normalVCVSOutput = -normalVCVSOutput; }']
            ).result;
        } else {
          if (actor.getProperty().getRepresentation() === REPRESENTATIONS.VTK_WIREFRAME) {
            // generate a normal for lines, it will be perpendicular to the line
            // and maximally aligned with the camera view direction
            // no clue if this is the best way to do this.
            // the code below has been optimized a bit so what follows is
            // an explanation of the basic approach. Compute the gradient of the line
            // with respect to x and y, the the larger of the two
            // cross that with the camera view direction. That gives a vector
            // orthogonal to the camera view and the line. Note that the line and the camera
            // view are probably not orthogonal. Which is why when we cross result that with
            // the line gradient again we get a reasonable normal. It will be othogonal to
            // the line (which is a plane but maximally aligned with the camera view.
            FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::UniformFlow::Impl', [
              '  vec3 fdx = vec3(dFdx(vertexVC.x),dFdx(vertexVC.y),dFdx(vertexVC.z));',
              '  vec3 fdy = vec3(dFdy(vertexVC.x),dFdy(vertexVC.y),dFdy(vertexVC.z));',
              '  //VTK::UniformFlow::Impl'] // For further replacements
              ).result;
            FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Normal::Impl', [
              'vec3 normalVCVSOutput;',
              '  fdx = normalize(fdx);',
              '  fdy = normalize(fdy);',
              '  if (abs(fdx.x) > 0.0)',
              '    { normalVCVSOutput = normalize(cross(vec3(fdx.y, -fdx.x, 0.0), fdx)); }',
              '  else { normalVCVSOutput = normalize(cross(vec3(fdy.y, -fdy.x, 0.0), fdy));}']
              ).result;
          } else {
            FSSource = vtkShaderProgram.substitute(FSSource,
              '//VTK::Normal::Dec', [
                'uniform int cameraParallel;']).result;

            FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::UniformFlow::Impl', [
              // '  vec3 fdx = vec3(dFdx(vertexVC.x),dFdx(vertexVC.y),dFdx(vertexVC.z));',
              // '  vec3 fdy = vec3(dFdy(vertexVC.x),dFdy(vertexVC.y),dFdy(vertexVC.z));',
              '  vec3 fdx = dFdx(vertexVC.xyz);',
              '  vec3 fdy = dFdy(vertexVC.xyz);',
              '  //VTK::UniformFlow::Impl'] // For further replacements
              ).result;
            FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Normal::Impl', [
              '  fdx = normalize(fdx);',
              '  fdy = normalize(fdy);',
              '  vec3 normalVCVSOutput = normalize(cross(fdx,fdy));',
              // the code below is faster, but does not work on some devices
              // 'vec3 normalVC = normalize(cross(dFdx(vertexVC.xyz), dFdy(vertexVC.xyz)));',
              '  if (cameraParallel == 1 && normalVCVSOutput.z < 0.0) { normalVCVSOutput = -1.0*normalVCVSOutput; }',
              '  if (cameraParallel == 0 && dot(normalVCVSOutput,vertexVC.xyz) > 0.0) { normalVCVSOutput = -1.0*normalVCVSOutput; }',
            ]).result;
          }
        }
      }
      shaders.Vertex = VSSource;
      shaders.Geometry = GSSource;
      shaders.Fragment = FSSource;
    }
  };

  publicAPI.replaceShaderPositionVC = (shaders, ren, actor) => {
    let VSSource = shaders.Vertex;
    let GSSource = shaders.Geometry;
    let FSSource = shaders.Fragment;

     // do we need the vertex in the shader in View Coordinates
    if (model.lastLightComplexity.get(model.lastBoundBO) > 0) {
      VSSource = vtkShaderProgram.substitute(VSSource,
        '//VTK::PositionVC::Dec', [
          'varying vec4 vertexVCVSOutput;']).result;
      VSSource = vtkShaderProgram.substitute(VSSource,
        '//VTK::PositionVC::Impl', [
          'vertexVCVSOutput = MCVCMatrix * vertexMC;',
          '  gl_Position = MCDCMatrix * vertexMC;']).result;
      VSSource = vtkShaderProgram.substitute(VSSource,
        '//VTK::Camera::Dec', [
          'uniform mat4 MCDCMatrix;',
          'uniform mat4 MCVCMatrix;']).result;
      GSSource = vtkShaderProgram.substitute(GSSource,
        '//VTK::PositionVC::Dec', [
          'in vec4 vertexVCVSOutput[];',
          'out vec4 vertexVCGSOutput;']).result;
      GSSource = vtkShaderProgram.substitute(GSSource,
        '//VTK::PositionVC::Impl', [
          'vertexVCGSOutput = vertexVCVSOutput[i];']).result;
      FSSource = vtkShaderProgram.substitute(FSSource,
        '//VTK::PositionVC::Dec', [
          'varying vec4 vertexVCVSOutput;']).result;
      FSSource = vtkShaderProgram.substitute(FSSource,
        '//VTK::PositionVC::Impl', [
          'vec4 vertexVC = vertexVCVSOutput;']).result;
    } else {
      VSSource = vtkShaderProgram.substitute(VSSource,
        '//VTK::Camera::Dec', [
          'uniform mat4 MCDCMatrix;']).result;
      VSSource = vtkShaderProgram.substitute(VSSource,
        '//VTK::PositionVC::Impl', [
          '  gl_Position = MCDCMatrix * vertexMC;']).result;
    }
    shaders.Vertex = VSSource;
    shaders.Geometry = GSSource;
    shaders.Fragment = FSSource;
  };

  publicAPI.replaceShaderValues = (shaders, ren, actor) => {
    publicAPI.replaceShaderColor(shaders, ren, actor);
    publicAPI.replaceShaderNormal(shaders, ren, actor);
    publicAPI.replaceShaderLight(shaders, ren, actor);
    publicAPI.replaceShaderPositionVC(shaders, ren, actor);
  };

  publicAPI.getNeedToRebuildShaders = (cellBO, ren, actor) => {
    let lightComplexity = 0;

    // wacky backwards compatibility with old VTK lighting
    // soooo there are many factors that determine if a primative is lit or not.
    // three that mix in a complex way are representation POINT, Interpolation FLAT
    // and having normals or not.
    let needLighting = false;
    const haveNormals = false; // (model.currentInput.getPointData().getNormals() != null);
    if (actor.getProperty().getRepresentation() === REPRESENTATIONS.VTK_POINTS) {
      needLighting = (actor.getProperty().getInterpolation() !== SHADINGS.VTK_FLAT && haveNormals);
    } else {
      const isTrisOrStrips = (cellBO === model.tris || cellBO === model.triStrips);
      needLighting = (isTrisOrStrips ||
        (!isTrisOrStrips && actor.getProperty().getInterpolation() !== SHADINGS.VTK_FLAT && haveNormals));
    }

    // do we need lighting?
    if (actor.getProperty().getLighting() && needLighting) {
      // consider the lighting complexity to determine which case applies
      // simple headlight, Light Kit, the whole feature set of VTK
      lightComplexity = 0;
      let numberOfLights = 0;

      ren.getLights().forEach(light => {
        const status = light.getSwitch();
        if (status > 0) {
          numberOfLights++;
          if (lightComplexity === 0) {
            lightComplexity = 1;
          }
        }

        if (lightComplexity === 1
            && (numberOfLights > 1
              || light.getIntensity() !== 1.0
              || !light.lightTypeIsHeadLight())) {
          lightComplexity = 2;
        }
        if (lightComplexity < 3
            && (light.getPositional())) {
          lightComplexity = 3;
        }
      });
    }

    if (model.lastLightComplexity.get(cellBO) !== lightComplexity) {
      model.lightComplexityChanged.get(cellBO).modified();
      model.lastLightComplexity.set(cellBO, lightComplexity);
    }

    // has something changed that would require us to recreate the shader?
    // candidates are
    // property modified (representation interpolation and lighting)
    // input modified
    // light complexity changed
    if (cellBO.getProgram() === 0 ||
        cellBO.getShaderSourceTime().getMTime() < publicAPI.getMTime() ||
        cellBO.getShaderSourceTime().getMTime() < actor.getMTime() ||
        cellBO.getShaderSourceTime().getMTime() < model.currentInput.getMTime() ||
        cellBO.getShaderSourceTime().getMTime() < model.lightComplexityChanged.get(cellBO).getMTime()) {
      return true;
    }

    return false;
  };

  publicAPI.updateShaders = (cellBO, ren, actor) => {
    cellBO.getVAO().bind();
    model.lastBoundBO = cellBO;

    // has something changed that would require us to recreate the shader?
    if (publicAPI.getNeedToRebuildShaders(cellBO, ren, actor)) {
      const shaders = { Vertex: null, Fragment: null, Geometry: null };

      publicAPI.buildShaders(shaders, ren, actor);

      // compile and bind the program if needed
      const newShader =
        model.openglRenderWindow.getShaderCache().readyShaderProgramArray(shaders.Vertex, shaders.Fragment, shaders.Geometry);

      // if the shader changed reinitialize the VAO
      if (newShader !== cellBO.getProgram()) {
        cellBO.setProgram(newShader);
        // reset the VAO as the shader has changed
        cellBO.getVAO().releaseGraphicsResources();
      }

      cellBO.getShaderSourceTime().modified();
    } else {
      model.openglRenderWindow.getShaderCache().readyShaderProgram(cellBO.getProgram());
    }

    publicAPI.setMapperShaderParameters(cellBO, ren, actor);
    publicAPI.setPropertyShaderParameters(cellBO, ren, actor);
    publicAPI.setCameraShaderParameters(cellBO, ren, actor);
    publicAPI.setLightingShaderParameters(cellBO, ren, actor);
  };

  publicAPI.setMapperShaderParameters = (cellBO, ren, actor) => {
    // Now to update the VAO too, if necessary.
    cellBO.getProgram().setUniformi('PrimitiveIDOffset',
      model.primitiveIDOffset);

    if (cellBO.getCABO().getElementCount() && (model.VBOBuildTime > cellBO.getAttributeUpdateTime().getMTime() ||
        cellBO.getShaderSourceTime().getMTime() > cellBO.getAttributeUpdateTime().getMTime())) {
      cellBO.getCABO().bind();
      if (cellBO.getProgram().isAttributeUsed('vertexMC')) {
        if (!cellBO.getVAO().addAttributeArray(cellBO.getProgram(), cellBO.getCABO(),
                                           'vertexMC', cellBO.getCABO().getVertexOffset(),
                                           cellBO.getCABO().getStride(), model.context.FLOAT, 3,
                                           model.context.FALSE)) {
          vtkErrorMacro('Error setting vertexMC in shader VAO.');
        }
      }
      if (cellBO.getProgram().isAttributeUsed('normalMC') &&
          cellBO.getCABO().getNormalOffset() && model.lastLightComplexity.get(cellBO) > 0) {
        if (!cellBO.getVAO().addAttributeArray(cellBO.getProgram(), cellBO.getCABO(),
                                           'normalMC', cellBO.getCABO().getNormalOffset(),
                                           cellBO.getCABO().getStride(), model.context.FLOAT, 3,
                                           model.context.FALSE)) {
          vtkErrorMacro('Error setting normalMC in shader VAO.');
        }
      }
    //   if (model.VBO.TCoordComponents && !model.DrawingEdges &&
    //       cellBO.Program.IsAttributeUsed('tcoordMC'))
    //     {
    //     if (!cellBO.getVAO().AddAttributeArray(cellBO.Program, model.VBO,
    //                                     'tcoordMC', model.VBO.TCoordOffset,
    //                                     model.VBO.Stride, VTK_FLOAT, model.VBO.TCoordComponents, false))
    //       {
    //       vtkErrorMacro(<< 'Error setting 'tcoordMC' in shader VAO.');
    //       }
    //     }
    //   if (model.VBO.ColorComponents != 0 && !model.DrawingEdges &&
    //       cellBO.Program.IsAttributeUsed('scalarColor'))
    //     {
    //     if (!cellBO.getVAO().AddAttributeArray(cellBO.Program, model.VBO,
    //                                     'scalarColor', model.VBO.ColorOffset,
    //                                     model.VBO.Stride, VTK_UNSIGNED_CHAR,
    //                                     model.VBO.ColorComponents, true))
    //       {
    //       vtkErrorMacro(<< 'Error setting 'scalarColor' in shader VAO.');
    //       }
    }
  };

  publicAPI.setLightingShaderParameters = (cellBO, ren, actor) => {
    // for unlit and headlight there are no lighting parameters
    if (model.lastLightComplexity.get(cellBO) < 2) {
      return;
    }

    const program = cellBO.getProgram();

    // for lightkit case there are some parameters to set
    // const cam = ren.getActiveCamera();
    // const viewTF = cam.getModelViewTransformObject();

    // bind some light settings
    let numberOfLights = 0;

    const lightColor = [];
    // const lightDirection = [];
    // const lightHalfAngle = [];
    const lights = ren.getLights();
    Object.keys(lights).map(key => lights[key]).forEach(light => {
      const status = light.getSwitch();
      if (status > 0.0) {
        const dColor = light.getDiffuseColor();
        const intensity = light.getIntensity();
        lightColor[numberOfLights][0] = dColor[0] * intensity;
        lightColor[numberOfLights][1] = dColor[1] * intensity;
        lightColor[numberOfLights][2] = dColor[2] * intensity;
        // get required info from light
        // double *lfp = light.getTransformedFocalPoint();
        // double *lp = light.getTransformedPosition();
        // double lightDir[3];
        // vtkMath::Subtract(lfp,lp,lightDir);
        // vtkMath::Normalize(lightDir);
        // double *tDir = viewTF.TransformNormal(lightDir);
        // lightDirection[numberOfLights][0] = tDir[0];
        // lightDirection[numberOfLights][1] = tDir[1];
        // lightDirection[numberOfLights][2] = tDir[2];
        // lightDir[0] = -tDir[0];
        // lightDir[1] = -tDir[1];
        // lightDir[2] = -tDir[2]+1.0;
        // vtkMath::Normalize(lightDir);
        // lightHalfAngle[numberOfLights][0] = lightDir[0];
        // lightHalfAngle[numberOfLights][1] = lightDir[1];
        // lightHalfAngle[numberOfLights][2] = lightDir[2];
        numberOfLights++;
      }
    });

    program.setUniform3fv('lightColor', numberOfLights, lightColor);
    // program.setUniform3fv('lightDirectionVC', numberOfLights, lightDirection);
    // program.setUniform3fv('lightHalfAngleVC', numberOfLights, lightHalfAngle);
    program.setUniformi('numberOfLights', numberOfLights);

    // // we are done unless we have positional lights
    if (model.lastLightComplexity.get(cellBO) < 3) {
      return;
    }

    // // if positional lights pass down more parameters
    // let lightAttenuation[6][3];
    // let lightPosition[6][3];
    // let lightConeAngle[6];
    // let lightExponent[6];
    // int lightPositional[6];
    // numberOfLights = 0;
    // for(lc.InitTraversal(sit);
    //     (light = lc.getNextLight(sit)); )
    //   {
    //   let status = light.getSwitch();
    //   if (status > 0.0)
    //     {
    //     double *attn = light.getAttenuationValues();
    //     lightAttenuation[numberOfLights][0] = attn[0];
    //     lightAttenuation[numberOfLights][1] = attn[1];
    //     lightAttenuation[numberOfLights][2] = attn[2];
    //     lightExponent[numberOfLights] = light.getExponent();
    //     lightConeAngle[numberOfLights] = light.getConeAngle();
    //     double *lp = light.getTransformedPosition();
    //     double *tlp = viewTF.TransformPoint(lp);
    //     lightPosition[numberOfLights][0] = tlp[0];
    //     lightPosition[numberOfLights][1] = tlp[1];
    //     lightPosition[numberOfLights][2] = tlp[2];
    //     lightPositional[numberOfLights] = light.getPositional();
    //     numberOfLights++;
    //     }
    //   }
    // program.SetUniform3fv('lightAttenuation', numberOfLights, lightAttenuation);
    // program.SetUniform1iv('lightPositional', numberOfLights, lightPositional);
    // program.SetUniform3fv('lightPositionVC', numberOfLights, lightPosition);
    // program.SetUniform1fv('lightExponent', numberOfLights, lightExponent);
    // program.SetUniform1fv('lightConeAngle', numberOfLights, lightConeAngle);
  };

  publicAPI.setCameraShaderParameters = (cellBO, ren, actor) => {
    const program = cellBO.getProgram();

    const keyMats = model.openglCamera.getKeyMatrices(ren);
    const cam = ren.getActiveCamera();

    // // [WMVD]C == {world, model, view, display} coordinates
    // // E.g., WCDC == world to display coordinate transformation
    program.setUniformMatrix('MCDCMatrix', keyMats.wcdc);
    if (program.isUniformUsed('MCVCMatrix')) {
      program.setUniformMatrix('MCVCMatrix', keyMats.wcvc);
    }
    if (program.isUniformUsed('normalMatrix')) {
      program.setUniformMatrix3x3('normalMatrix', keyMats.normalMatrix);
    }

    if (program.isUniformUsed('cameraParallel')) {
      program.setUniformi('cameraParallel', cam.getParallelProjection());
    }
  };

  publicAPI.setPropertyShaderParameters = (cellBO, ren, actor) => {
    const program = cellBO.getProgram();

    const ppty = actor.getProperty();

    const opacity = ppty.getOpacity();
    const aColor = ppty.getAmbientColor();
    const aIntensity = ppty.getAmbient();
    const ambientColor = [aColor[0] * aIntensity,
      aColor[1] * aIntensity,
      aColor[2] * aIntensity];
    const dColor = ppty.getDiffuseColor();
    const dIntensity = ppty.getDiffuse();
    const diffuseColor = [dColor[0] * dIntensity,
      dColor[1] * dIntensity,
      dColor[2] * dIntensity];

    program.setUniformf('opacityUniform', opacity);
    program.setUniform3f('ambientColorUniform', ambientColor);
    program.setUniform3f('diffuseColorUniform', diffuseColor);
    // we are done unless we have lighting
    if (model.lastLightComplexity.get(cellBO) < 1) {
      return;
    }
    const sColor = ppty.getSpecularColor();
    const sIntensity = ppty.getSpecular();
    const specularColor = [sColor[0] * sIntensity,
      sColor[1] * sIntensity,
      sColor[2] * sIntensity];
    program.setUniform3f('specularColorUniform', specularColor);
    const specularPower = ppty.getSpecularPower();
    program.setUniformf('specularPowerUniform', specularPower);

    // // now set the backface properties if we have them
    // if (actor.getBackfaceProperty() && !model.DrawingEdges)
    //   {
    //   ppty = actor.getBackfaceProperty();

    //   let opacity = static_cast<float>(ppty.getOpacity());
    //   double *aColor = ppty.getAmbientColor();
    //   double aIntensity = ppty.getAmbient();  // ignoring renderer ambient
    //   let ambientColor[3] = {static_cast<float>(aColor[0] * aIntensity),
    //     static_cast<float>(aColor[1] * aIntensity),
    //     static_cast<float>(aColor[2] * aIntensity)};
    //   double *dColor = ppty.getDiffuseColor();
    //   double dIntensity = ppty.getDiffuse();
    //   let diffuseColor[3] = {static_cast<float>(dColor[0] * dIntensity),
    //     static_cast<float>(dColor[1] * dIntensity),
    //     static_cast<float>(dColor[2] * dIntensity)};
    //   double *sColor = ppty.getSpecularColor();
    //   double sIntensity = ppty.getSpecular();
    //   let specularColor[3] = {static_cast<float>(sColor[0] * sIntensity),
    //     static_cast<float>(sColor[1] * sIntensity),
    //     static_cast<float>(sColor[2] * sIntensity)};
    //   double specularPower = ppty.getSpecularPower();

    //   program.SetUniformf('opacityUniformBF', opacity);
    //   program.SetUniform3f('ambientColorUniformBF', ambientColor);
    //   program.SetUniform3f('diffuseColorUniformBF', diffuseColor);
    //   // we are done unless we have lighting
    //   if (model.LastLightComplexity[&cellBO] < 1)
    //     {
    //     return;
    //     }
    //   program.SetUniform3f('specularColorUniformBF', specularColor);
    //   program.SetUniformf('specularPowerUniformBF', specularPower);
    //   }
  };

  publicAPI.renderPieceStart = (ren, actor) => {
    model.primitiveIDOffset = 0;

    // make sure the BOs are up to date
    publicAPI.updateBufferObjects(ren, actor);

    // Bind the OpenGL, this is shared between the different primitive/cell types.
    model.lastBoundBO = null;
  };

  publicAPI.renderPieceDraw = (ren, actor) => {
    const representation = actor.getProperty().getRepresentation();

    const gl = model.context;

    // draw points
    if (model.points.getCABO().getElementCount()) {
      // Update/build/etc the shader.
      publicAPI.updateShaders(model.points, ren, actor);
      gl.drawArrays(gl.POINTS, 0,
        model.Points.getCABO().getElementCount());
      model.primitiveIDOffset += model.Points.getCABO().getElementCount();
    }

    // draw lines
    if (model.lines.getCABO().getElementCount()) {
      publicAPI.updateShaders(model.lines, ren, actor);
      if (representation === REPRESENTATIONS.VTK_POINTS) {
        gl.drawArrays(gl.POINTS, 0,
          model.Lines.getCABO().getElementCount());
      } else {
        gl.drawArrays(gl.LINES, 0,
          model.Lines.getCABO().getElementCount());
      }
      model.primitiveIDOffset += model.lines.getCABO().getElementCount() / 2;
    }

    // draw polygons
    if (model.tris.getCABO().getElementCount()) {
      // First we do the triangles, update the shader, set uniforms, etc.
      publicAPI.updateShaders(model.tris, ren, actor);
      let mode = gl.POINTS;
      if (representation === REPRESENTATIONS.VTK_WIREFRAME) {
        mode = gl.LINES;
      }
      if (representation === REPRESENTATIONS.VTK_SURFACE) {
        mode = gl.TRIANGLES;
      }
      gl.drawArrays(mode, 0,
        model.tris.getCABO().getElementCount());
      model.primitiveIDOffset += model.tris.getCABO().getElementCount() / 3;
    }

    // draw strips
    if (model.triStrips.getCABO().getElementCount()) {
      // Use the tris shader program/VAO, but triStrips ibo.
      model.updateShaders(model.triStrips, ren, actor);
      if (representation === REPRESENTATIONS.VTK_POINTS) {
        gl.drawArrays(gl.POINTS, 0,
          model.triStrips.getCABO().getElementCount());
      }
      if (representation === REPRESENTATIONS.VTK_WIREFRAME) {
        gl.drawArays(gl.LINES, 0,
          model.triStrips.getCABO().getElementCount());
      }
      if (representation === REPRESENTATIONS.VTK_SURFACE) {
        gl.drawArrays(gl.TRIANGLES, 0,
         model.triStrips.getCABO().getElementCount());
      }
      // just be safe and divide by 3
      model.primitiveIDOffset += model.triStrips.getCABO().getElementCount() / 3;
    }
  };

  publicAPI.renderPieceFinish = (ren, actor) => {
    if (model.LastBoundBO) {
      model.LastBoundBO.getVAO().release();
    }
  };

  publicAPI.renderPiece = (ren, actor) => {
    // Make sure that we have been properly initialized.
    // if (ren.getRenderWindow().checkAbortStatus()) {
    //   return;
    // }

    model.currentInput = model.renderable.getInputData();

    if (model.currentInput === null) {
      vtkErrorMacro('No input!');
      return;
    }

    publicAPI.invokeEvent({ type: 'StartEvent' });
    // if (!model.Static) {
    //   this.getInputAlgorithm().update();
    // }
    publicAPI.invokeEvent({ type: 'EndEvent' });

    // if there are no points then we are done
    if (!model.currentInput.getPoints || !model.currentInput.getPoints().getNumberOfValues()) {
      return;
    }

    publicAPI.renderPieceStart(ren, actor);
    publicAPI.renderPieceDraw(ren, actor);
    // publicAPI.renderEdges(ren, actor);
    publicAPI.renderPieceFinish(ren, actor);
  };

  publicAPI.computeBounds = (ren, actor) => {
    if (!publicAPI.getInput()) {
      vtkMath.uninitializeBounds(model.Bounds);
      return;
    }
    model.bounnds = publicAPI.getInput().getBounds();
  };

  publicAPI.updateBufferObjects = (ren, actor) => {
    // Rebuild buffers if needed
    if (publicAPI.getNeedToRebuildBufferObjects(ren, actor)) {
      publicAPI.buildBufferObjects(ren, actor);
    }
  };

  publicAPI.getNeedToRebuildBufferObjects = (ren, actor) => {
    // first do a coarse check
    if (model.VBOBuildTime.getMTime() < publicAPI.getMTime() ||
        model.VBOBuildTime.getMTime() < actor.getMTime() ||
        model.VBOBuildTime.getMTime() < model.currentInput.mtime) {
      return true;
    }
    return false;
  };

  publicAPI.buildBufferObjects = (ren, actor) => {
    const poly = model.currentInput;

    if (poly === null) {
      return;
    }

    // Do we have normals?
    const n = (actor.getProperty().getInterpolation() !== SHADINGS.VTK_FLAT) ? poly.getPointData().getNormals() : null;

    // rebuild the VBO if the data has changed we create a string for the VBO what
    // can change the VBO? points normals tcoords colors so what can change those?
    // the input data is clearly one as it can change all four items tcoords may
    // haveTextures or not colors may change based on quite a few mapping
    // parameters in the mapper

    const toString = `${poly.getMTime()}AB${(n ? n.getMTime() : 1)}C`;

    const tcoords = null;
    const c = null;
    if (model.VBOBuildString !== toString) {
      // Build the VBOs
      const points = poly.getPoints();

      const representation = actor.getProperty().getRepresentation();
      model.points.getCABO().createVBO(poly.getVerts(), 'verts', representation, points,
          n, tcoords, c);
      model.lines.getCABO().createVBO(poly.getLines(), 'lines', representation, points,
          n, tcoords, c);
      model.tris.getCABO().createVBO(poly.getPolys(), 'polys', representation, points,
          n, tcoords, c);
      model.triStrips.getCABO().createVBO(poly.getStrips(), 'strips', representation, points,
          n, tcoords, c);

      model.VBOBuildTime.modified();
      model.VBOBuildString = toString;
    }
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  context: null,
  VBOBuildTime: 0,
  VBOBuildString: null,
  lightComplexityChanged: null,
  lastLightComplexity: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkViewNode.extend(publicAPI, model);

  model.points = vtkHelper.newInstance();
  model.lines = vtkHelper.newInstance();
  model.tris = vtkHelper.newInstance();
  model.triStrips = vtkHelper.newInstance();

  // Build VTK API
  macro.get(publicAPI, model, ['shaderCache']);
  macro.setGet(publicAPI, model, [
    'context',
  ]);

  model.VBOBuildTime = {};
  macro.obj(model.VBOBuildTime);

  model.lightComplexityChanged = new Map();
  model.lightComplexityChanged.set(model.points, {});
  macro.obj(model.lightComplexityChanged.get(model.points));
  model.lightComplexityChanged.set(model.lines, {});
  macro.obj(model.lightComplexityChanged.get(model.lines));
  model.lightComplexityChanged.set(model.tris, {});
  macro.obj(model.lightComplexityChanged.get(model.tris));
  model.lightComplexityChanged.set(model.triStrips, {});
  macro.obj(model.lightComplexityChanged.get(model.triStrips));

  model.lastLightComplexity = new Map();
  model.lastLightComplexity.set(model.points, 0);
  model.lastLightComplexity.set(model.lines, 0);
  model.lastLightComplexity.set(model.tris, 0);
  model.lastLightComplexity.set(model.triStrips, 0);

  // Object methods
  vtkOpenGLPolyDataMapper(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
