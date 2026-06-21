// Jest config: two projects so backend tests run in Node and front-end tests
// run in a jsdom (browser-like) environment, all from one `npm test`.
module.exports = {
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/backend/**/*.test.js'],
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/frontend/**/*.test.js'],
    },
  ],
  // Coverage focuses on the units under test (the ratings system + helpers).
  collectCoverageFrom: ['server.js', 'db.js', 'public/rating.js'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    // The application helpers in rating.js are fully covered; the one remaining
    // branch is the UMD env-detection boilerplate (unreachable in a single env).
    './public/rating.js': { branches: 85, functions: 100, lines: 95, statements: 95 },
  },
};
