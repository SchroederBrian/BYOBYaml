import { describe, expect, test } from 'bun:test';
import * as Blockly from 'blockly/core';
import YAML from 'yaml';
import { b, file, newProject, normalizeProject, parseByob, stack, toByob } from '../src/project';
import * as model from '../src/project';
import { generate } from '../src/blocks/generator';
import { registerBlocks } from '../src/blocks/register';
import { loadState } from '../src/blocks/value';
import { checkData, findSecrets } from '../src/market/shared';
import * as marketModel from '../src/market/shared';
import { projectVars } from '../src/market/preview';

const globals = [
  { name: 'APP', values: { dev: 'shared-dev', prod: 'shared-prod' } },
  { name: 'REGISTRY', values: { dev: 'registry.test', prod: 'registry.prod' } },
];
const locals = [
  { name: 'APP', values: { dev: 'local-dev', prod: 'local-prod' } },
  { name: 'PRIVATE', values: { dev: 'only-here', prod: 'only-here-prod' } },
];
const fixture = () => ({
  ...newProject(),
  variables: structuredClone(globals),
  files: [
    { ...file('one.yaml', 'k8s', stack(b('k8s_deployment', { NAME: '${APP}', REPLICAS: 1 }), [])), variables: structuredClone(locals) },
    file('two.yaml', 'k8s', stack(b('k8s_deployment', { NAME: '${APP}', REPLICAS: 1 }), [])),
  ],
});

describe('file and global variables', () => {
  test('keeps legacy project variables global', () => {
    const project = normalizeProject({ ...newProject(), variables: globals });
    expect(project.variables).toEqual(globals);
    expect(model.resolveVariables(project, project.files[0])).toEqual({ APP: 'shared-dev', REGISTRY: 'registry.test' });
  });

  test('preserves file-local variables on save and reload', () => {
    const project = parseByob(toByob([fixture()])).projects[0];
    expect(project.files[0].variables).toEqual(locals);
    expect(project.files[1].variables ?? []).toEqual([]);
    expect(project.variables).toEqual(globals);
  });

  test('overrides global names only in the owning file', () => {
    const project = fixture();
    expect(model.resolveVariables(project, project.files[0])).toEqual({ APP: 'local-dev', REGISTRY: 'registry.test', PRIVATE: 'only-here' });
    expect(model.resolveVariables(project, project.files[1])).toEqual({ APP: 'shared-dev', REGISTRY: 'registry.test' });
    expect(model.resolveVariables(null)).toEqual({});
  });

  test('switches both scopes to the active environment and honors empty local values', () => {
    const project = { ...fixture(), activeEnv: 'prod' };
    expect(model.resolveVariables(project, project.files[0]).APP).toBe('local-prod');
    expect(model.resolveVariables(project, project.files[1]).APP).toBe('shared-prod');
    project.files[0].variables![0].values.prod = '';
    expect(model.resolveVariables(project, project.files[0]).APP).toBe('');
  });

  test('generates different YAML for each file without leaking private values', () => {
    registerBlocks();
    const project = normalizeProject(fixture());
    const names = project.files.map((f) => {
      const ws = new Blockly.Workspace();
      try {
        loadState(f.state, ws);
        return YAML.parse(generate(ws, model.resolveVariables(project, f)).yaml).metadata.name;
      } finally {
        ws.dispose();
      }
    });
    expect(names).toEqual(['local-dev', 'shared-dev']);
  });

  test('preserves local variables when validating shared files and projects', () => {
    const project = fixture();
    const sharedFile = checkData('file', project.files[0]).data as any;
    expect(sharedFile.variables).toEqual(locals);
    const sharedProject = checkData('project', project).data as any;
    expect(sharedProject.files[0].variables).toEqual(locals);
    expect(projectVars(sharedProject, sharedProject.files[0]).APP).toBe('local-dev');
    expect(projectVars(sharedProject, sharedProject.files[1]).APP).toBe('shared-dev');
  });

  test('finds secrets in local variables for both file and project sharing', () => {
    const project = fixture();
    project.files[0].variables!.push({ name: 'DB_PASSWORD', values: { dev: 'sensitive-example-value', prod: '' } });
    expect(findSecrets(project).some((hint) => hint.key === 'DB_PASSWORD')).toBe(true);
    expect(findSecrets(project.files[0]).some((hint) => hint.key === 'DB_PASSWORD')).toBe(true);
  });

  test('strips global and local values when sharing without changing the source', () => {
    const project = fixture();
    const clean = marketModel.stripVariableValues(project);
    expect(clean.variables[0].values).toEqual({ dev: '', prod: '' });
    expect(clean.files[0].variables![0].values).toEqual({ dev: '', prod: '' });
    expect(marketModel.stripVariableValues(project.files[0]).variables![0].values).toEqual({ dev: '', prod: '' });
    expect(project.files[0].variables![0].values.dev).toBe('local-dev');
    expect(project.variables[0].values.dev).toBe('shared-dev');
  });
});
