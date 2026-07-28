// This file is for TypeScript only; Wrangler/esbuild itself replaces these files
// during the build process according to the documented bundling table
// (html/txt/sql => string, jpg/png/... => ArrayBuffer with the "Data" rule).

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.jpg" {
  const content: ArrayBuffer;
  export default content;
}

declare module "*.jpeg" {
  const content: ArrayBuffer;
  export default content;
}

declare module "*.png" {
  const content: ArrayBuffer;
  export default content;
}
