import "./globals.css";

export const metadata = {
  title: "Módulo de Importaciones - Icom Salud",
  description: "Evolucion mensual de posiciones arancelarias por categoria",
};

// 26/08/2026 ("ingreso pero no carga nada de info"): la cookie de
// sesion (icom_auth) puede quedar bloqueada por el navegador cuando
// este proyecto vive embebido en un iframe cross-origin (dentro de
// panel-icom-salud) -- pasa en mobile con protecciones anti-tracking
// estrictas. El login inicial ya no depende de esa cookie (ver
// middleware.ts, panelAuth por query param), pero los ~15 fetch()
// sueltos que hace la app despues (categorias, datos, sieve, pvp,
// etc., todos a /api/*) SI dependian de que el navegador mandara esa
// cookie solo -- si la bloquea, esos pedidos vuelven 401 y la pantalla
// queda vacia ("No hay opciones"), aunque la pagina en si ya cargo
// bien.
//
// Fix sin tocar cada fetch() suelto: este script corre ANTES de que
// React hidrate (esta en el <head>, se ejecuta durante el parseo del
// HTML) y hace 2 cosas -- (1) guarda el token de panelAuth de la URL
// en sessionStorage (que SI es del propio iframe, no depende de la
// politica de cookies de terceros) para que sobreviva mas alla de la
// carga inicial, y (2) parchea window.fetch una sola vez para que
// TODO pedido mande ese token en un header propio (x-panel-auth) --
// el middleware lo acepta como alternativa a la cookie en cualquier
// request, no solo en la carga inicial (ver middleware.ts).
const PANEL_AUTH_BOOTSTRAP = `
(function(){
  try{
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('panelAuth');
    if(fromUrl) sessionStorage.setItem('icom_panel_auth', fromUrl);
    var token = sessionStorage.getItem('icom_panel_auth');
    if(!token) return;
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      init = init ? Object.assign({}, init) : {};
      var headers = new Headers(init.headers || {});
      headers.set('x-panel-auth', token);
      init.headers = headers;
      return origFetch(input, init);
    };
  }catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: PANEL_AUTH_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
