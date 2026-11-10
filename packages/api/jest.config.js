// rdf-validate-shacl and several of its dependencies are ESM-only. Jest runs in
// CJS mode, so transform those packages (and their ESM deps) to CJS as well.
const jsTransform = {
  tsconfig: {
    allowJs: true,
    module: 'commonjs',
    target: 'ES2020',
    esModuleInterop: true,
    skipLibCheck: true,
    declaration: false,
    declarationMap: false,
  },
  isolatedModules: true,
};

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@sse/(.*)$': '<rootDir>/../$1/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    '^.+\\.js$': ['ts-jest', jsTransform],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:rdf-validate-shacl|@rdfjs|@vocabulary|@tpluscode|clownface|rdf-dataset-ext|rdf-literal|rdf-validate-datatype)/)',
  ],
  testTimeout: 30000,
};
