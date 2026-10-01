// Web Worker entry: all job logic lives in jobs.js so the page can also run it directly as a fallback.
import { runJob } from './jobs.js';

self.onmessage = (ev) => runJob(ev.data, (msg, transfer) => self.postMessage(msg, transfer || []));
