/// <reference types="vite/client" />

declare module '*.mjs?url' {
  const src: string;
  export default src;
}

declare module '*.mjs?raw' {
  const src: string;
  export default src;
}
