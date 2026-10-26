# Zori · Sistema de datos (locales y productos)

## Qué contiene este paquete
- `local.html` → UNA sola página para todos los locales (`local.html?id=bacoa`). Reemplaza a las 20 páginas individuales.
- `locales.html` → listado nuevo, se arma solo desde los datos (reemplaza el actual).
- `js/app.js` · `css/zori-app.css` → lógica y estilos nuevos (carrito, pedido a WhatsApp, Firebase).
- `data/locales.csv` · `data/productos.csv` → los datos actuales (20 locales, 588 productos).
- `img/locales/` · `img/productos/` → las imágenes que ya usabas, con nombres sin espacios.
- `zori-datos.xlsx` → la misma información en Excel, con listas desplegables.

## Cómo instalarlo (sin romper nada)
1. Subí todo este contenido a la raíz de tu repositorio (junto a `index.html`). NO borres nada todavía: las páginas viejas siguen funcionando.
2. Abrí `https://zorydelivery-ship-it.github.io/beta-2.0/locales.html` y probá un local y un pedido.
3. Cuando confirmes que todo anda, podés borrar los HTML individuales de cada local y las imágenes sueltas de la raíz.

## Cómo actualizar precios / productos / imágenes
**Opción A · Con Google Sheets (cambios al instante, recomendada)**
1. Subí `zori-datos.xlsx` a Google Drive → abrilo con Google Sheets.
2. Compartir → "Cualquier persona con el enlace" → Lector.
3. Copiá el ID de la URL (lo que está entre `/d/` y `/edit`) y pegalo en `js/app.js`, en `SHEET_ID: ""`.
4. Desde ese momento editás la hoja y la web se actualiza sola (hasta 5 minutos por la caché). Si la hoja falla, la web usa los CSV como respaldo.

**Opción B · Solo con Excel**
1. Editá `zori-datos.xlsx`.
2. Guardá cada pestaña como CSV (UTF-8) con los nombres `locales.csv` y `productos.csv` y reemplazá los de `data/`.

**Imágenes:** subí el archivo a `img/productos/` (o `img/locales/` para logos y banners) y escribí en la planilla solo el nombre (`carnivora.jpg`).

## Notas
- `bodega`, `supermercados` y `Farmacias` usan otra lógica y no están incluidos todavía.
- Las fotos con link `images.unsplash.com` son de ejemplo: conviene reemplazarlas por fotos reales.
- Faltan en tu repo las imágenes de El Rey Pelé (`el rey pele logo.jpeg`, `elreypele-banner.png`).
