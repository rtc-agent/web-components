/// <reference types="vite/client" />

// Vite ?raw import: import file content as a string
declare module '*?raw' {
  const content: string;
  export default content;
}

// Vite ?sharedworker import: factory function that returns a SharedWorker
declare module '*?sharedworker' {
  const factory: (options?: WorkerOptions) => SharedWorker;
  export default factory;
}
