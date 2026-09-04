/// <reference types="vite/client" />

// Vite ?raw 导入：将文件内容作为字符串导入
declare module '*?raw' {
  const content: string;
  export default content;
}
