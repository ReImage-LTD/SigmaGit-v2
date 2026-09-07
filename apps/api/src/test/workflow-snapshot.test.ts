import { expect, test } from 'bun:test';
import { parseWorkflowDefinition } from '../workflows/snapshot';

test('workflow snapshots parse scalar events and multiline branch filters', () => {
  expect(parseWorkflowDefinition('on: push\njobs: {build: {}}').triggers).toEqual({ push: { branches: undefined } });
  expect(parseWorkflowDefinition('on:\n  push:\n    branches:\n      - main\n      - release/*\njobs: {build: {}}').triggers.push?.branches).toEqual(['main', 'release/*']);
  expect(parseWorkflowDefinition('on: [push, workflow_dispatch]\njobs: {build: {}}').triggers.workflow_dispatch).toBe(true);
});
