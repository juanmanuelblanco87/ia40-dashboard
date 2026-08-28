/** @type {import('next').NextConfig} */
const nextConfig = {
  // 28/08/2026 (build roto en Vercel, "ENOENT ... headers-order.json"):
  // header-generator (dependencia de got-scraping, ver
  // lib/meliItemPrice.ts) usa `__dirname` en tiempo de ejecución para
  // encontrar sus propios archivos de datos (data_files/*.json,
  // fs.readFileSync). Si Next.js empaqueta ese código con webpack
  // (comportamiento por default para Route Handlers), __dirname pasa
  // a apuntar adentro de .next/server/..., no a la carpeta real del
  // paquete en node_modules -- el archivo nunca existe ahí, sin
  // importar qué se incluya en el deploy (probado -- reproducido y
  // confirmado localmente antes de este fix, outputFileTracingIncludes
  // NO alcanza porque el problema es de bundling, no de qué se copia).
  // serverComponentsExternalPackages saca estos paquetes del bundle de
  // webpack -- Next los deja resolver con require() normal de Node en
  // tiempo de ejecución, donde __dirname sí apunta a su ubicación
  // real. (Next 15 renombró esto a serverExternalPackages top-level;
  // en 14.2.x -- la versión de este proyecto, ver package.json -- va
  // anidado bajo experimental, confirmado leyendo
  // node_modules/next/dist/server/config-shared.d.ts.)
  experimental: {
    serverComponentsExternalPackages: ["got-scraping", "header-generator"],
  },
};
export default nextConfig;
