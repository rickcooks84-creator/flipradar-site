let stopped = false;
export function setStopSignal(val: boolean) { stopped = val; }
export function isStopSignaled(): boolean { return stopped; }
