// Сообщения Fluent подключаются текстом: import ruFtl from '…/ui.ftl?raw' (Vite).
declare module '*.ftl?raw' {
  const source: string;
  export default source;
}
