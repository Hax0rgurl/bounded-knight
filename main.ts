import { fileURLToPath } from 'node:url';

// Replace Node so the native forge owns the process and trial lifecycle.
const executable = fileURLToPath(new URL('./bin/goof-linux-amd64', import.meta.url));
process.execve(executable, [executable, ...process.argv.slice(2)], process.env);
