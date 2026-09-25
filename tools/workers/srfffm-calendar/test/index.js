/*
 * Entry point for `node --test test/`: Node resolves a directory argument to its index.js,
 * so this file loads every suite.
 */
import './ical.test.js';
import './format.test.js';
import './worker.test.js';
