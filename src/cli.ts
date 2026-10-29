import { buildProgram, runProgram } from './program.js';

await runProgram(buildProgram(), process.argv);
