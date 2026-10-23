// Web worker that generates character geometry off the main thread.
import { runJob } from './modelGen.js';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const out = runJob(job);
    const transfer = [];
    for (const v of Object.values(out)) {
      if (ArrayBuffer.isView(v) && !transfer.includes(v.buffer)) transfer.push(v.buffer);
    }
    self.postMessage({ id, out }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
