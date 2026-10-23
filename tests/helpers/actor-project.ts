import { readFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';

export function actorFixture(name = 'nonhuman'): ActorProject {
  return JSON.parse(readFileSync(new URL(`../fixtures/actor-projects/${name}.project.json`, import.meta.url), 'utf8')) as ActorProject;
}
