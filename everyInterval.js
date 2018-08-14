const everyInterval = (cb, interval) => {
  let timeoutHandle = null;
  let intervalHandle = null;

  const nextInterval = interval - (Date.now() % interval);
  timeoutHandle = setTimeout(() => {
    timeoutHandle = null;
    intervalHandle = setInterval(cb, interval);
    cb();
  }, nextInterval);

  return () => {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
    if (intervalHandle != null) clearInterval(intervalHandle);
  };
};

module.exports = everyInterval;
