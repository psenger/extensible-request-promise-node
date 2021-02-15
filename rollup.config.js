import pkg from './package.json';
import copy from 'rollup-plugin-copy';

export default [
    {
        input: 'src/index.js',
        external: ['ms'],
        output: [
            { file: pkg.main, format: 'cjs' }
        ],
        plugins: [
            copy({
                targets: [
                    { src: 'src/extensible-request-promise-node/index.d.ts', dest: 'dist/extensible-request-promise-node' },
                ]
            })
        ]
    }
];
