/// <reference types="vite/client" />

// Vite ?raw import: import file content as a string
declare module '*?raw' {
  const content: string;
  export default content;
}
