import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { babel } from '@rollup/plugin-babel';
import { readFileSync } from 'node:fs';
import { parseRepository, repositoryName } from './src/repository-state.js';

const pages = process.env.BUILD_PAGES === 'true';
const dev = Boolean(process.env.ROLLUP_WATCH) && !pages;
const repository = process.env.BLACKBOARD_REPOSITORY;
const defaultRepository = repository ? repositoryName(parseRepository(repository)) : '';

export default {
  input: 'src/main.js',
  output: {
    file: pages ? '../docs/main.js' : 'dist/main.js',
    format: 'es',
    sourcemap: !pages,
  },
  plugins: [
    {
      name: 'repository-default',
      resolveImportMeta(property) {
        if (property === 'BLACKBOARD_REPOSITORY') return JSON.stringify(defaultRepository);
      },
    },
    nodeResolve({ browser: true, exportConditions: ['browser'] }),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      exclude: 'node_modules/**',
      presets: ['babel-preset-solid'],
    }),
    ...(pages ? [{
      name: 'pages-assets',
      generateBundle() {
        for (const fileName of ['index.html', 'style.css', 'lyra.jpg']) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(`dist/${fileName}`) });
        }
        this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      },
    }] : []),
    ...(dev
      ? [
          {
            name: 'watch-static-files',
            buildStart() {
              this.addWatchFile('dist/index.html');
              this.addWatchFile('dist/style.css');
            },
          },
          serve({
            contentBase: 'dist', host: 'localhost', port: 3000, open: true,
            headers: { 'Cache-Control': 'no-store' },
          }),
          livereload({
            watch: 'dist',
            usePolling: true,
            applyCSSLive: false,
            delay: 200,
          }),
        ]
      : []),
  ],
};
