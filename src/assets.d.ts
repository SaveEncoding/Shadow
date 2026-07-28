// این فایل فقط برای TypeScript هست؛ خود Wrangler/esbuild این فایل‌ها رو
// طبق جدول bundling مستندسازی‌شده (html/txt/sql => string, jpg/png/... => ArrayBuffer با rule "Data")
// در زمان build جایگزین می‌کنه.

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
