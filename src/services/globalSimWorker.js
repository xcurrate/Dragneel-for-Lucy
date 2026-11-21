// Worker untuk simulasi global. Menerima satu potong daftar lawan, menjalankan
// pertarungannya, lalu mengirim ringkasan — bukan daftar pertarungan.
const { parentPort, workerData } = require('node:worker_threads');
const { aggregateChunk } = require('./globalSimCore');

const { playerSpecs, opponents, units, seed } = workerData;
parentPort.postMessage(aggregateChunk(playerSpecs, opponents, { seed, units }));
