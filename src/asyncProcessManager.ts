interface Process<T> {
	promise: Promise<T>;
	key: string;
}

class AsyncProcessManager<TArgs extends any[] = [], TRet = any> {
	private processes: Map<string, Process<TRet>> = new Map();
	constructor(private executor: (...args: TArgs) => Promise<TRet>) { }

	public execute(key: string, ...args: TArgs): Promise<TRet> {
		if (this.processes.has(key)) {
			return this.processes.get(key).promise;
		} else {
			const runningPromise = this.executor(...args);
			const process = {
				key: key,
				promise: runningPromise
			};
			this.processes.set(key, process);
			runningPromise.then(() => this.processes.delete(key));
			return runningPromise;
		}
	}
}

export { AsyncProcessManager };