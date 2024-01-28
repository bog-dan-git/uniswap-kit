import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  verbose: true,
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testTimeout: 300_000,
  setupFiles: ['./tests/setup.ts'],
};

export default config;
