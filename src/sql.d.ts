/** Arquivos .sql importados como texto (loader "text" do Angular/esbuild). */
declare module '*.sql' {
  const content: string;
  export default content;
}
