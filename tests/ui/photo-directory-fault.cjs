// Explicitly opted-in, isolated review only. Forward all real filesystem work
// except the named directory sync while the controller's marker is present.
const fs = require('node:fs');
const promises = require('node:fs/promises');
if (process.env.MTG_PHOTO_DIRECTORY_FAULT !== '1' ||
    process.env.UPLOADS_DATA_PATH !== '/durability-uploads' ||
    !/^\/review_sync_\w+$/.test(new URL(process.env.DATABASE_URL).pathname))
  throw new Error('Directory fault requires the dedicated disposable review target');
const original = promises.open;
promises.open = async function (file, ...args) {
  const handle = await original.call(this, file, ...args);
  if (String(file) !== '/durability-uploads/acquisition-v1' || args[0] !== 'r') return handle;
  return new Proxy(handle, { get(target, key) {
    if (key === 'sync') return async () => {
      if (fs.existsSync('/durability-flags/fail-sync')) {
        fs.appendFileSync('/durability-flags/events', 'refused\n');
        throw Object.assign(new Error('controlled private directory failure'), { code: 'EIO' });
      }
      await target.sync();
      fs.appendFileSync('/durability-flags/events', 'synced\n');
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
require('node:module').syncBuiltinESMExports();
