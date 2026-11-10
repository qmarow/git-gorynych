// Типы собранного highlight.js (hljs.js рядом): только то, что вызывает src/lib/highlight.ts.
declare const hljs: {
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
  getLanguage(name: string): { name?: string } | undefined;
};
export default hljs;
