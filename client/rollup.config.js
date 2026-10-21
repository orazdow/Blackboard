import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { babel } from '@rollup/plugin-babel';

const dev = Boolean(process.env.ROLLUP_WATCH);

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/main.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    nodeResolve({ browser: true, exportConditions: ['browser'] }),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      exclude: 'node_modules/**',
      presets: ['babel-preset-solid'],
    }),
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
