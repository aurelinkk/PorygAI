import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite affiche un ExperimentalWarning à chaque process : inutile dans les tests.
    poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'] } },
  },
});
